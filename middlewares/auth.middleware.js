const { getDb } = require('../config/db');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'En-tête Authorization manquant ou invalide' });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const db = getDb();

    const { data: session, error } = await db
      .from('sessions')
      .select('id, utilisateur_id, expire_le')
      .eq('token', token)
      .single();

    if (error || !session) {
      return res.status(401).json({ message: 'Jeton de session invalide' });
    }

    if (new Date(session.expire_le) <= new Date()) {
      return res.status(401).json({ message: 'Session expirée' });
    }

    const { data: user, error: userError } = await db
      .from('utilisateurs')
      .select('id, telephone, role_id')
      .eq('id', session.utilisateur_id)
      .single();
    if (userError || !user) {
      return res.status(401).json({ message: 'Aucun utilisateur associé à cette session' });
    }

    const { data: role } = await db.from('roles').select('nom').eq('id', user.role_id).maybeSingle();

    req.auth = {
      sessionId: session.id,
      userId: session.utilisateur_id,
      telephone: user.telephone,
      role: role ? role.nom : null,
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authMiddleware };
