/**
 * Service de personnalisation algorithmique.
 * Gère le calcul des scores de pertinence basés sur le comportement utilisateur.
 */

const { getDb } = require('../config/db');

// Poids par type d'interaction
const WEIGHTS = {
  VIEW_PRODUCT: 1,
  VIEW_ENTERPRISE: 2,
  SEARCH_CLICK: 3,
  CATEGORY_CLICK: 2,
  ADD_TO_CART: 5,
  PURCHASE: 10
};

// Facteur de décroissance temporelle (les interactions récentes valent plus)
// Score = Poids * exp(-lambda * jours)
const DECAY_LAMBDA = 0.1; 

/**
 * Enregistre une interaction utilisateur.
 */
async function recordInteraction(userId, { type, targetId, targetType, categoryId, metadata }) {
  if (!userId) return;
  const db = getDb();
  
  const weight = WEIGHTS[type.toUpperCase()] || 1;

  await db.from('user_interactions').insert({
    user_id: userId,
    interaction_type: type,
    target_id: targetId,
    target_type: targetType,
    category_id: categoryId,
    metadata,
    weight
  });

  // Optionnel: Déclencher un recalcul asynchrone du score pour cet utilisateur/cible
  // Pour rester fluide, on peut le faire à la volée lors de la lecture ou via un worker
}

/**
 * Récupère les scores de pertinence pour un utilisateur donné.
 * Retourne une Map { targetId: score }
 */
async function getUserScores(userId) {
  if (!userId) return new Map();
  const db = getDb();

  // On récupère les interactions des 30 derniers jours
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error } = await db
    .from('user_interactions')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', since.toISOString());

  if (error || !data) return new Map();

  const scores = new Map();
  const now = new Date();

  data.forEach(inter => {
    const daysDiff = (now - new Date(inter.created_at)) / (1000 * 60 * 60 * 24);
    const decay = Math.exp(-DECAY_LAMBDA * daysDiff);
    const contribution = inter.weight * decay;

    const current = scores.get(inter.target_id) || 0;
    scores.set(inter.target_id, current + contribution);

    // Si l'interaction est liée à une catégorie, on booste aussi les articles de cette catégorie
    if (inter.category_id) {
        const catScore = scores.get(inter.category_id) || 0;
        scores.set(inter.category_id, catScore + (contribution * 0.5));
    }
  });

  return scores;
}

/**
 * Trie une liste d'items (produits ou entreprises) selon les scores de l'utilisateur.
 * Intègre un mécanisme de rotation pour éviter la monotonie.
 */
function personalizeResults(items, userScores, options = {}) {
  const { rotationStrength = 0.2 } = options;

  const sorted = items.map(item => {
    let score = userScores.get(item.id) || 0;
    
    // Boost par catégorie si l'item a une catégorie
    if (item.categorie_id && userScores.has(item.categorie_id)) {
        score += userScores.get(item.categorie_id) * 0.3;
    }

    // Mécanisme de rotation : on ajoute un petit facteur aléatoire
    // pour que l'ordre ne soit pas 100% identique à chaque visite
    const noise = Math.random() * rotationStrength;
    
    return { ...item, _personal_score: score + noise };
  });

  return sorted.sort((a, b) => b._personal_score - a._personal_score);
}

module.exports = {
  recordInteraction,
  getUserScores,
  personalizeResults,
  WEIGHTS
};
