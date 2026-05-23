/** Étapes horaires pour commandes / livraisons (API + admin + mobile). */

function formatDateTimeFr(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function step(key, label, at) {
  if (!at) return null;
  return { key, label, at, label_fr: formatDateTimeFr(at) };
}

function buildSteps(rawSteps) {
  return rawSteps.filter(Boolean);
}

function mapLivraisonTimeline(liv) {
  if (!liv) return [];
  return buildSteps([
    step('created', 'Livraison créée', liv.created_at),
    step('assigned', 'Livreur en route', liv.attribuee_at || liv.assigne_le),
    step('collected', 'Récupérée chez le commerce', liv.collectee_at),
    step('delivered', 'Livraison terminée', liv.livree_at || liv.livre_le),
    liv.echec_at ? step('failed', 'Échec de livraison', liv.echec_at) : null,
  ]);
}

function mapSousCommandeTimeline(sc) {
  if (!sc) return [];
  return buildSteps([
    step('created', 'Commande envoyée au commerce', sc.created_at),
    step('accepted', 'Acceptée par le commerce', sc.acceptee_at),
    step('refused', 'Refusée', sc.refusee_at),
    step('ready', 'Prête pour le livreur', sc.prete_at),
    step('collected', 'Récupérée par le livreur', sc.collectee_at),
    step('delivered', 'Livrée chez vous', sc.livree_at),
  ]);
}

function mapCommandeTimeline(commande, sousCommandes = [], livraisons = []) {
  return {
    commande: buildSteps([
      step('created', 'Commande passée', commande?.created_at || commande?.cree_le),
      step('accepted', 'Commande acceptée', commande?.acceptee_at),
      step('delivered', 'Commande livrée', commande?.livree_at || commande?.livree_le),
      step('cancelled', 'Commande annulée', commande?.annulee_at),
    ]),
    sous_commandes: (sousCommandes || []).map((sc) => ({
      id: sc.id,
      numero: sc.numero,
      timeline: mapSousCommandeTimeline(sc),
    })),
    livraisons: (livraisons || []).map((liv) => ({
      id: liv.id,
      statut: liv.statut,
      timeline: mapLivraisonTimeline(liv),
    })),
  };
}

function mapTimestampFields(entity, fieldMap) {
  const out = {};
  for (const [outKey, dbKey] of Object.entries(fieldMap)) {
    const v = entity?.[dbKey];
    if (v) {
      out[outKey] = v;
      out[`${outKey}_label`] = formatDateTimeFr(v);
    }
  }
  return out;
}

const COMMANDE_TIMESTAMP_FIELDS = {
  created_at: 'created_at',
  acceptee_at: 'acceptee_at',
  livree_at: 'livree_at',
  annulee_at: 'annulee_at',
  updated_at: 'updated_at',
};

const LIVRAISON_TIMESTAMP_FIELDS = {
  created_at: 'created_at',
  attribuee_at: 'attribuee_at',
  collectee_at: 'collectee_at',
  livree_at: 'livree_at',
  updated_at: 'updated_at',
};

module.exports = {
  formatDateTimeFr,
  buildSteps,
  mapLivraisonTimeline,
  mapSousCommandeTimeline,
  mapCommandeTimeline,
  mapTimestampFields,
  COMMANDE_TIMESTAMP_FIELDS,
  LIVRAISON_TIMESTAMP_FIELDS,
};
