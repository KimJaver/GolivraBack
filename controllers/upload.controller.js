const { createHttpError, requireFields } = require('../utils/http');
const { getSupabaseClient } = require('../services/supabase.service');

const ALLOWED_FOLDERS = new Set(['profiles', 'enterprises']);

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw createHttpError(400, "Image invalide (attendu: data URL 'data:image/...;base64,...').");
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw createHttpError(400, "Image invalide (format base64 requis).");
  }
  const contentType = match[1];
  const base64 = match[2];
  return { contentType, base64 };
}

function extFromContentType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return null;
}

function storageErrorMessage(error) {
  const msg = String(error?.message || error || 'Erreur storage');
  if (msg.toLowerCase().includes('bucket') || msg.toLowerCase().includes('not found')) {
    return "Bucket Supabase Storage introuvable. Créez le bucket 'public' (voir sql/fix-otp-and-storage.sql) et définissez SUPABASE_STORAGE_BUCKET=public sur Render.";
  }
  return msg;
}

async function uploadBase64Image(req, res, next) {
  try {
    requireFields(req.body, ['dataUrl', 'folder']);
    const { dataUrl, folder } = req.body;

    if (!ALLOWED_FOLDERS.has(folder)) {
      throw createHttpError(400, 'Dossier invalide (profiles ou enterprises).');
    }

    const { contentType, base64 } = parseDataUrl(dataUrl);
    const ext = extFromContentType(contentType);
    if (!ext) {
      throw createHttpError(400, 'Format non supporté (jpeg, png, webp).');
    }

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length < 32) {
      throw createHttpError(400, 'Fichier image vide.');
    }
    if (buffer.length > 1_500_000) {
      throw createHttpError(413, 'Image trop lourde (max 1.5MB).');
    }

    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public';
    const supabase = getSupabaseClient();
    const ownerKey = req.auth?.userId || 'public';
    const fileName = `${Date.now()}-${ownerKey}.${ext}`;
    const objectPath = `${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
      contentType,
      upsert: true,
    });

    if (uploadError) {
      throw createHttpError(503, storageErrorMessage(uploadError));
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (!data?.publicUrl) {
      throw createHttpError(500, "Impossible d'obtenir l'URL publique.");
    }

    return res.status(201).json({
      url: data.publicUrl,
      path: objectPath,
      contentType,
      size: buffer.length,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { uploadBase64Image };
