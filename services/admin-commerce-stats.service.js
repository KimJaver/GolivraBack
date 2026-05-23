/**
 * Statistiques commerce (restaurant / boutique) pour l’admin — données issues des sous-commandes en base.
 * CA produits = sous_total (hors livraison). Aucune commission GoLivra sur les ventes.
 */

function startOfPeriod(days) {
  if (days == null) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
}

function aggregateForPeriod(rows, items, sinceIso) {
  const filtered = sinceIso ? rows.filter((r) => r.created_at >= sinceIso) : rows;
  const scIds = new Set(filtered.map((r) => r.id));

  let caProduits = 0;
  let fraisLivraison = 0;
  let totalClient = 0;
  let commandes = 0;
  let livrees = 0;
  let annulees = 0;
  let enCours = 0;

  for (const sc of filtered) {
    commandes += 1;
    caProduits += Number(sc.sous_total ?? 0);
    fraisLivraison += Number(sc.frais_livraison ?? 0);
    totalClient += Number(sc.total ?? 0);
    const st = sc.statut || '';
    if (st === 'livree') livrees += 1;
    else if (st === 'annulee' || st === 'refusee') annulees += 1;
    else enCours += 1;
  }

  const productMap = new Map();
  for (const it of items) {
    if (!scIds.has(it.sous_commande_id)) continue;
    const nom = String(it.nom_produit || 'Article').trim() || 'Article';
    const q = Number(it.quantite ?? 1);
    const ca = Number(it.sous_total ?? 0);
    const prev = productMap.get(nom) || { nom, quantite: 0, ca_fcfa: 0 };
    prev.quantite += q;
    prev.ca_fcfa += ca;
    productMap.set(nom, prev);
  }

  const top_produits = [...productMap.values()]
    .sort((a, b) => b.ca_fcfa - a.ca_fcfa || b.quantite - a.quantite)
    .slice(0, 10);

  return {
    commandes,
    commandes_livrees: livrees,
    commandes_annulees: annulees,
    commandes_en_cours: enCours,
    ca_produits_fcfa: caProduits,
    frais_livraison_fcfa: fraisLivraison,
    total_paye_client_fcfa: totalClient,
    panier_moyen_fcfa: commandes > 0 ? Math.round(caProduits / commandes) : 0,
    top_produits,
  };
}

async function getCommerceStatsForEnterprise(db, enterpriseId, kind) {
  const fk = kind === 'restaurant' ? 'restaurant_id' : 'boutique_id';

  const { data: sousCommandes, error } = await db
    .from('sous_commandes')
    .select('id, statut, sous_total, frais_livraison, total, remise, created_at')
    .eq(fk, enterpriseId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = sousCommandes || [];
  const scIds = rows.map((r) => r.id);
  let items = [];
  if (scIds.length > 0) {
    const { data: itemRows, error: itemErr } = await db
      .from('sous_commande_items')
      .select('sous_commande_id, nom_produit, quantite, sous_total')
      .in('sous_commande_id', scIds);
    if (itemErr) throw itemErr;
    items = itemRows || [];
  }

  const periodes = {
    j7: aggregateForPeriod(rows, items, startOfPeriod(7)),
    j30: aggregateForPeriod(rows, items, startOfPeriod(30)),
    j90: aggregateForPeriod(rows, items, startOfPeriod(90)),
    total: aggregateForPeriod(rows, items, null),
  };

  return {
    source: 'sous_commandes',
    commission_ventes_golivra_fcfa: 0,
    note: 'CA produits = montant marchand (sous_total). Commission GoLivra uniquement sur frais de livraison.',
    periodes,
    mis_a_jour_le: new Date().toISOString(),
  };
}

module.exports = { getCommerceStatsForEnterprise };
