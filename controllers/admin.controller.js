const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');

async function createCourier(req, res, next) {
  try {
    const { utilisateurId, typeVehicule, entrepriseLogistiqueId } = req.body;
    requireFields(req.body, ['utilisateurId', 'typeVehicule']);

    const db = getDb();

    const { data: exists } = await db.from('livreurs').select('id').eq('utilisateur_id', utilisateurId).maybeSingle();
    if (exists) throw createHttpError(409, 'Ce compte a déjà un profil livreur.');

    const { data, error } = await db
      .from('livreurs')
      .insert({
        utilisateur_id: utilisateurId,
        type_vehicule: typeVehicule,
        entreprise_logistique_id: entrepriseLogistiqueId || null,
        est_disponible: false,
        est_approuve: true,
      })
      .select('*')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
}

function mapRestaurantAdmin(r, owner) {
  return {
    ...r,
    type: 'restaurant',
    statut_moderation: r.statut,
    ouvert: r.est_ouvert,
    adresse: r.adresse_ligne1,
    proprietaire: owner || null,
  };
}

function mapBoutiqueAdmin(b, owner) {
  return {
    ...b,
    type: 'boutique',
    statut_moderation: b.statut,
    ouvert: b.est_ouvert,
    adresse: b.adresse_ligne1,
    proprietaire: owner || null,
  };
}

async function loadOwnerMap(db, ownerIds) {
  const unique = [...new Set(ownerIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data, error } = await db
    .from('utilisateurs')
    .select('id, nom, telephone, email, est_approuve, created_at, role_id')
    .in('id', unique);
  if (error) throw error;

  const roleIds = [...new Set((data || []).map((u) => u.role_id).filter(Boolean))];
  let roleMap = new Map();
  if (roleIds.length > 0) {
    const { data: roles } = await db.from('roles').select('id, nom').in('id', roleIds);
    roleMap = new Map((roles || []).map((r) => [r.id, r.nom]));
  }

  const map = new Map();
  for (const u of data || []) {
    map.set(u.id, {
      id: u.id,
      nom: u.nom,
      telephone: u.telephone,
      email: u.email,
      est_approuve: u.est_approuve,
      created_at: u.created_at,
      role: roleMap.get(u.role_id) || null,
    });
  }
  return map;
}

async function mergeEnterprises(db, restaurants, boutiques) {
  const ownerIds = [
    ...(restaurants || []).map((r) => r.proprietaire_id),
    ...(boutiques || []).map((b) => b.proprietaire_id),
  ];
  const owners = await loadOwnerMap(db, ownerIds);
  const merged = [
    ...(restaurants || []).map((r) => mapRestaurantAdmin(r, owners.get(r.proprietaire_id))),
    ...(boutiques || []).map((b) => mapBoutiqueAdmin(b, owners.get(b.proprietaire_id))),
  ];
  merged.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || '')));
  return merged;
}

async function approveOwnerUser(db, ownerId, adminId) {
  if (!ownerId) return;
  await db
    .from('utilisateurs')
    .update({ est_approuve: true, raison_rejet: null })
    .eq('id', ownerId);
  void adminId;
}

async function updateEnterpriseById(db, enterpriseId, patch) {
  const rTry = await db.from('restaurants').update(patch).eq('id', enterpriseId).select('*');
  if (rTry.error) throw rTry.error;
  if (rTry.data && rTry.data.length > 0) {
    return { kind: 'restaurant', row: rTry.data[0] };
  }

  const bTry = await db.from('boutiques').update(patch).eq('id', enterpriseId).select('*');
  if (bTry.error) throw bTry.error;
  if (bTry.data && bTry.data.length > 0) {
    return { kind: 'boutique', row: bTry.data[0] };
  }

  return null;
}

async function findEnterpriseById(db, enterpriseId) {
  const { data: resto, error: rErr } = await db.from('restaurants').select('*').eq('id', enterpriseId).maybeSingle();
  if (rErr) throw rErr;
  if (resto) return { kind: 'restaurant', row: resto };

  const { data: bout, error: bErr } = await db.from('boutiques').select('*').eq('id', enterpriseId).maybeSingle();
  if (bErr) throw bErr;
  if (bout) return { kind: 'boutique', row: bout };

  return null;
}

async function getAdminStats(req, res, next) {
  try {
    const db = getDb();
    const [
      pendingRestaurants,
      pendingBoutiques,
      activeRestaurants,
      activeBoutiques,
      pendingUsers,
      ordersRes,
    ] = await Promise.all([
      db.from('restaurants').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente'),
      db.from('boutiques').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente'),
      db.from('restaurants').select('id', { count: 'exact', head: true }).eq('statut', 'active'),
      db.from('boutiques').select('id', { count: 'exact', head: true }).eq('statut', 'active'),
      db
        .from('utilisateurs')
        .select('id, role_id, est_approuve')
        .eq('est_approuve', false),
      db.from('commandes').select('id', { count: 'exact', head: true }),
    ]);

    if (pendingRestaurants.error) throw pendingRestaurants.error;
    if (pendingBoutiques.error) throw pendingBoutiques.error;
    if (activeRestaurants.error) throw activeRestaurants.error;
    if (activeBoutiques.error) throw activeBoutiques.error;
    if (pendingUsers.error) throw pendingUsers.error;
    if (ordersRes.error) throw ordersRes.error;

    const roleIds = [...new Set((pendingUsers.data || []).map((u) => u.role_id))];
    let merchantPendingCount = pendingUsers.data?.length || 0;
    if (roleIds.length > 0) {
      const { data: roles } = await db.from('roles').select('id, nom').in('id', roleIds);
      const merchantRoleIds = new Set(
        (roles || []).filter((r) => r.nom === 'restaurateur' || r.nom === 'commercant').map((r) => r.id),
      );
      merchantPendingCount = (pendingUsers.data || []).filter((u) => merchantRoleIds.has(u.role_id)).length;
    }

    return res.json({
      commerces_en_attente: (pendingRestaurants.count || 0) + (pendingBoutiques.count || 0),
      commerces_actifs: (activeRestaurants.count || 0) + (activeBoutiques.count || 0),
      comptes_marchands_en_attente: merchantPendingCount,
      commandes_total: ordersRes.count || 0,
    });
  } catch (error) {
    return next(error);
  }
}

async function listAllEnterprises(req, res, next) {
  try {
    const { status, type, q } = req.query;
    const db = getDb();
    const search = typeof q === 'string' ? q.trim().toLowerCase() : '';

    let restaurants = [];
    let boutiques = [];

    if (!type || type === 'restaurant') {
      let query = db.from('restaurants').select('*').order('created_at', { ascending: false });
      if (status) query = query.eq('statut', status);
      const { data, error } = await query;
      if (error) throw error;
      restaurants = data || [];
    }

    if (!type || type === 'boutique') {
      let query = db.from('boutiques').select('*').order('created_at', { ascending: false });
      if (status) query = query.eq('statut', status);
      const { data, error } = await query;
      if (error) throw error;
      boutiques = data || [];
    }

    let merged = await mergeEnterprises(db, restaurants, boutiques);

    if (search) {
      merged = merged.filter((e) => {
        const hay = [e.nom, e.telephone, e.adresse_ligne1, e.proprietaire?.nom, e.proprietaire?.telephone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(search);
      });
    }

    return res.json(merged);
  } catch (error) {
    return next(error);
  }
}

async function listEnterprisesPending(req, res, next) {
  req.query = { ...req.query, status: 'en_attente' };
  return listAllEnterprises(req, res, next);
}

async function getEnterpriseAdmin(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const found = await findEnterpriseById(db, enterpriseId);
    if (!found) throw createHttpError(404, 'Commerce introuvable.');

    const owners = await loadOwnerMap(db, [found.row.proprietaire_id]);
    const owner = owners.get(found.row.proprietaire_id) || null;

    let products = [];
    if (found.kind === 'restaurant') {
      const { data, error } = await db.from('plats').select('*').eq('restaurant_id', enterpriseId).order('nom');
      if (error) throw error;
      products = (data || []).map((p) => ({
        id: p.id,
        nom: p.nom,
        prix: p.prix,
        est_disponible: p.est_disponible,
        kind: 'plat',
      }));
    } else {
      const { data, error } = await db.from('articles').select('*').eq('boutique_id', enterpriseId).order('nom');
      if (error) throw error;
      products = (data || []).map((a) => ({
        id: a.id,
        nom: a.nom,
        prix: a.prix,
        stock: a.stock,
        est_disponible: a.est_disponible,
        kind: 'article',
      }));
    }

    const mapped =
      found.kind === 'restaurant'
        ? mapRestaurantAdmin(found.row, owner)
        : mapBoutiqueAdmin(found.row, owner);

    return res.json({ ...mapped, products });
  } catch (error) {
    return next(error);
  }
}

async function activateEnterprise(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const now = new Date().toISOString();

    const found = await findEnterpriseById(db, enterpriseId);
    if (!found) throw createHttpError(404, 'Commerce introuvable.');

    const updated = await updateEnterpriseById(db, enterpriseId, {
      statut: 'active',
      est_ouvert: true,
      approuve_par: req.auth.userId,
      approuve_at: now,
      note_moderation: null,
    });
    if (!updated) throw createHttpError(404, 'Commerce introuvable.');

    await approveOwnerUser(db, updated.row.proprietaire_id, req.auth.userId);

    const owners = await loadOwnerMap(db, [updated.row.proprietaire_id]);
    const owner = owners.get(updated.row.proprietaire_id) || null;
    const mapped =
      updated.kind === 'restaurant'
        ? mapRestaurantAdmin(updated.row, owner)
        : mapBoutiqueAdmin(updated.row, owner);

    return res.json(mapped);
  } catch (error) {
    return next(error);
  }
}

async function rejectEnterprise(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const { raison } = req.body || {};
    const db = getDb();

    const found = await findEnterpriseById(db, enterpriseId);
    if (!found) throw createHttpError(404, 'Commerce introuvable.');

    const updated = await updateEnterpriseById(db, enterpriseId, {
      statut: 'rejetee',
      est_ouvert: false,
      note_moderation: typeof raison === 'string' && raison.trim() ? raison.trim() : null,
    });
    if (!updated) throw createHttpError(404, 'Commerce introuvable.');

    const owners = await loadOwnerMap(db, [updated.row.proprietaire_id]);
    const owner = owners.get(updated.row.proprietaire_id) || null;
    const mapped =
      updated.kind === 'restaurant'
        ? mapRestaurantAdmin(updated.row, owner)
        : mapBoutiqueAdmin(updated.row, owner);

    return res.json(mapped);
  } catch (error) {
    return next(error);
  }
}

async function suspendEnterprise(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();

    const updated = await updateEnterpriseById(db, enterpriseId, {
      statut: 'suspendue',
      est_ouvert: false,
    });
    if (!updated) throw createHttpError(404, 'Commerce introuvable.');

    const owners = await loadOwnerMap(db, [updated.row.proprietaire_id]);
    const owner = owners.get(updated.row.proprietaire_id) || null;
    const mapped =
      updated.kind === 'restaurant'
        ? mapRestaurantAdmin(updated.row, owner)
        : mapBoutiqueAdmin(updated.row, owner);

    return res.json(mapped);
  } catch (error) {
    return next(error);
  }
}

async function listPendingUsers(req, res, next) {
  try {
    const db = getDb();
    const { data: users, error } = await db
      .from('utilisateurs')
      .select('id, nom, telephone, email, est_approuve, created_at, role_id')
      .eq('est_approuve', false)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const roleIds = [...new Set((users || []).map((u) => u.role_id))];
    const { data: roles } = roleIds.length
      ? await db.from('roles').select('id, nom').in('id', roleIds)
      : { data: [] };
    const roleMap = new Map((roles || []).map((r) => [r.id, r.nom]));

    const filtered = (users || [])
      .filter((u) => {
        const role = roleMap.get(u.role_id);
        return role === 'restaurateur' || role === 'commercant';
      })
      .map((u) => ({
        id: u.id,
        nom: u.nom,
        telephone: u.telephone,
        email: u.email,
        est_approuve: u.est_approuve,
        created_at: u.created_at,
        role: roleMap.get(u.role_id) || null,
      }));

    return res.json(filtered);
  } catch (error) {
    return next(error);
  }
}

async function approveUser(req, res, next) {
  try {
    const { userId } = req.params;
    const db = getDb();

    const { data: user, error } = await db
      .from('utilisateurs')
      .update({ est_approuve: true, raison_rejet: null })
      .eq('id', userId)
      .select('id, nom, telephone, email, est_approuve, created_at, role_id')
      .maybeSingle();
    if (error) throw error;
    if (!user) throw createHttpError(404, 'Utilisateur introuvable.');

    const { data: roleRow } = await db.from('roles').select('nom').eq('id', user.role_id).maybeSingle();

    return res.json({
      ...user,
      role: roleRow?.nom ?? null,
    });
  } catch (error) {
    return next(error);
  }
}

async function rejectUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { raison } = req.body || {};
    const db = getDb();

    const { data: user, error } = await db
      .from('utilisateurs')
      .update({
        est_approuve: false,
        est_actif: false,
        raison_rejet: typeof raison === 'string' && raison.trim() ? raison.trim() : null,
      })
      .eq('id', userId)
      .select('id, nom, telephone, email, est_approuve, created_at, role_id')
      .maybeSingle();
    if (error) throw error;
    if (!user) throw createHttpError(404, 'Utilisateur introuvable.');

    const { data: roleRow } = await db.from('roles').select('nom').eq('id', user.role_id).maybeSingle();

    return res.json({
      ...user,
      role: roleRow?.nom ?? null,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCourier,
  getAdminStats,
  listAllEnterprises,
  listEnterprisesPending,
  getEnterpriseAdmin,
  activateEnterprise,
  rejectEnterprise,
  suspendEnterprise,
  listPendingUsers,
  approveUser,
  rejectUser,
};
