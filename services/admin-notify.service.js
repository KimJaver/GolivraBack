const { notifyUserSafe } = require('./notification.service');

async function getRoleUserIds(db, roleName) {
  const { data: role } = await db.from('roles').select('id').eq('nom', roleName).maybeSingle();
  if (!role?.id) return [];
  const { data: users, error } = await db
    .from('utilisateurs')
    .select('id')
    .eq('role_id', role.id)
    .eq('est_actif', true);
  if (error) throw error;
  return (users || []).map((u) => u.id);
}

async function notifyAllAdmins(db, { type, titre, corps, data }) {
  const adminIds = await getRoleUserIds(db, 'admin');
  await Promise.all(
    adminIds.map((utilisateurId) =>
      notifyUserSafe(db, { utilisateurId, type: type || 'admin_alert', titre, corps, data }),
    ),
  );
  return adminIds.length;
}

async function notifyLogisticsManager(db, entrepriseLogistiqueId, { type, titre, corps, data }) {
  if (!entrepriseLogistiqueId) return 0;
  const { data: company } = await db
    .from('entreprises_logistiques')
    .select('gestionnaire_id, nom')
    .eq('id', entrepriseLogistiqueId)
    .maybeSingle();
  if (!company?.gestionnaire_id) return 0;
  await notifyUserSafe(db, {
    utilisateurId: company.gestionnaire_id,
    type: type || 'logistics_alert',
    titre,
    corps,
    data: { ...data, entreprise_logistique_id: entrepriseLogistiqueId },
  });
  return 1;
}

async function hasDedupeNotification(db, utilisateurId, dedupeKey) {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('notifications')
    .select('id')
    .eq('utilisateur_id', utilisateurId)
    .gte('created_at', since)
    .contains('data', { dedupe_key: dedupeKey })
    .limit(1);
  if (error) return false;
  return Boolean(data?.length);
}

async function notifyEnterprisePendingModeration(db, { type, nom, enterpriseId }) {
  const label = type === 'restaurant' ? 'restaurant' : 'boutique';
  await notifyAllAdmins(db, {
    type: 'commerce_en_attente',
    titre: `Nouveau ${label} à valider`,
    corps: `« ${nom} » attend votre confirmation pour apparaître sur le marketplace.`,
    data: { enterprise_id: enterpriseId, enterprise_type: type, action: 'review_enterprise' },
  });
}

async function notifyDeliveryDelay(db, liv, delay, commerceNom) {
  if (!delay?.en_retard) return;

  const dedupeKey = `retard:${liv.id}:${delay.type_retard}`;
  const ref = commerceNom || liv.client_nom || liv.id.slice(0, 8);
  const mins = delay.minutes_retard ?? 0;

  const adminIds = await getRoleUserIds(db, 'admin');
  for (const utilisateurId of adminIds) {
    const dup = await hasDedupeNotification(db, utilisateurId, dedupeKey);
    if (dup) continue;
    await notifyUserSafe(db, {
      utilisateurId,
      type: 'retard_livraison',
      titre: 'Livraison en retard',
      corps:
        delay.type_retard === 'assignation'
          ? `Aucun livreur attribué pour « ${ref} » depuis ${mins} min de retard.`
          : `La course « ${ref} » dépasse le délai de livraison (${mins} min de retard).`,
      data: {
        dedupe_key: dedupeKey,
        livraison_id: liv.id,
        type_retard: delay.type_retard,
        action: 'open_delivery',
      },
    });
  }

  if (liv.livreur_id) {
    const { data: courier } = await db
      .from('livreurs')
      .select('entreprise_logistique_id')
      .eq('id', liv.livreur_id)
      .maybeSingle();
    if (courier?.entreprise_logistique_id) {
      const { data: company } = await db
        .from('entreprises_logistiques')
        .select('gestionnaire_id')
        .eq('id', courier.entreprise_logistique_id)
        .maybeSingle();
      if (company?.gestionnaire_id) {
        const dup = await hasDedupeNotification(db, company.gestionnaire_id, dedupeKey);
        if (!dup) {
          await notifyUserSafe(db, {
            utilisateurId: company.gestionnaire_id,
            type: 'retard_livraison',
            titre: 'Course en retard',
            corps:
              delay.type_retard === 'assignation'
                ? `Attribuez un livreur pour « ${ref} » (${mins} min de retard).`
                : `La course « ${ref} » est en retard de ${mins} min.`,
            data: {
              dedupe_key: dedupeKey,
              livraison_id: liv.id,
              type_retard: delay.type_retard,
              action: 'open_delivery',
            },
          });
        }
      }
    }
  }
}

module.exports = {
  notifyAllAdmins,
  notifyLogisticsManager,
  notifyEnterprisePendingModeration,
  notifyDeliveryDelay,
  getRoleUserIds,
};
