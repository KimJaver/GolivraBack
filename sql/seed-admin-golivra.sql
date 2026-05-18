-- =============================================================================
-- GoLivra — Compte administrateur par défaut
-- E-mail : golivra@gmail.com
-- Mot de passe : 12345678  (hash bcrypt ci-dessous)
--
-- À exécuter dans l’éditeur SQL Supabase si le compte n’existe pas encore
-- dans la table `utilisateurs` (Auth Supabase ≠ table utilisateurs GoLivra).
-- =============================================================================

-- Optionnel : rendre le téléphone nullable pour les admins (recommandé)
-- \i sql/amendments-v3-auth-staff-web.sql

DO $$
DECLARE
  v_role_id UUID;
  v_user_id UUID;
  v_hash TEXT := '$2b$10$A954svh314RVbhTC71u1ruN3jCq9OnzJoMsz7p65QE5OlVALUo0PG';
BEGIN
  SELECT id INTO v_role_id FROM roles WHERE nom = 'admin' LIMIT 1;
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'Rôle admin introuvable — appliquez golivra-postgresql-schema-v3.sql';
  END IF;

  SELECT id INTO v_user_id FROM utilisateurs WHERE lower(trim(email)) = 'golivra@gmail.com' LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    UPDATE utilisateurs SET
      nom = 'GoLivra Admin',
      mot_de_passe_hash = v_hash,
      role_id = v_role_id,
      est_actif = TRUE,
      est_approuve = TRUE,
      est_verifie = TRUE,
      updated_at = NOW()
    WHERE id = v_user_id;
    RAISE NOTICE 'Admin mis à jour : golivra@gmail.com';
  ELSE
    INSERT INTO utilisateurs (
      nom, email, telephone, mot_de_passe_hash, role_id,
      est_actif, est_approuve, est_verifie
    ) VALUES (
      'GoLivra Admin',
      'golivra@gmail.com',
      '+242990000001',
      v_hash,
      v_role_id,
      TRUE, TRUE, TRUE
    );
    RAISE NOTICE 'Admin créé : golivra@gmail.com / mot de passe 12345678';
  END IF;
END $$;
