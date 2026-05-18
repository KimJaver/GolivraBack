-- =============================================================================
-- GoLivra v4 — Étape 1/2 : ajouter la valeur d'enum role_nom
-- À exécuter SEULE dans l'éditeur SQL Supabase, puis valider (Run).
-- PostgreSQL interdit d'utiliser une nouvelle valeur d'enum dans la même
-- transaction : l'étape 2 est dans amendments-v4-logistics-tenant-step2.sql
-- =============================================================================

ALTER TYPE role_nom ADD VALUE IF NOT EXISTS 'gestionnaire_logistique';
