/**
 * RÉCUPÉRATION DE MOT DE PASSE — écran affiché quand l'utilisateur arrive depuis le lien reçu par e-mail
 * (voir src/lib/cloud/auth.js : beginPasswordRecovery / updatePassword).
 *
 * Trois phases pilotées par GPXAnalyzer.jsx :
 *  - "checking" : la session de récupération est en cours d'établissement ;
 *  - "ready"    : formulaire (nouveau mot de passe + confirmation) ;
 *  - "error"    : lien expiré ou invalide — pas de formulaire, seulement un message et une sortie.
 * Après un enregistrement réussi, l'écran confirme et propose de continuer ; aucune autre donnée n'est touchée
 * (ni synchronisation, ni activités).
 */
import { useState } from "react";
import { KeyRound, CheckCircle2, AlertCircle } from "lucide-react";

import { PageHead } from "./UIPrimitives.jsx";
import { updatePassword } from "../lib/cloud/index.js";

const MIN_LENGTH = 6;

/**
 * @param {Object} props
 * @param {"checking"|"ready"|"error"} props.phase
 * @param {string|null} [props.email] - compte concerné (affiché pour que l'utilisateur sache quel mot de passe il change)
 * @param {string|null} [props.error] - message affiché en phase "error"
 * @param {Function} props.onDone - quitte l'écran (retour à l'application)
 */
export function PasswordRecoveryView({ phase, email, error, onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) {
      setFormError(`Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (password !== confirm) {
      setFormError("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await updatePassword(password);
      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setFormError(err.message || "Impossible de modifier le mot de passe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gpx-dashboard">
      <PageHead title={phase === "error" ? "Lien invalide" : "Nouveau mot de passe"} meta={email ? <span>Compte : {email}</span> : null} />

      <div className="gpx-panel gpx-recovery">
        {phase === "checking" && <p className="gpx-empty-note">Vérification du lien…</p>}

        {phase === "error" && (
          <>
            <div className="gpx-error-box gpx-recovery-box" role="alert">
              <AlertCircle size={16} />
              <span>{error || "Ce lien n'est pas valide."}</span>
            </div>
            <p className="gpx-empty-note gpx-recovery-help">
              Depuis Sources de données → Cloud, choisis « Mot de passe oublié ? » pour recevoir un nouveau lien.
            </p>
            <button className="gpx-btn-primary" onClick={onDone}>Retour à l'application</button>
          </>
        )}

        {phase === "ready" && !done && (
          <form className="gpx-cloud-form" onSubmit={handleSubmit}>
            <label className="gpx-cloud-field">
              Nouveau mot de passe
              <input
                type="password" required minLength={MIN_LENGTH} autoComplete="new-password" autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="gpx-cloud-field">
              Confirmer le mot de passe
              <input
                type="password" required minLength={MIN_LENGTH} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            <p className="gpx-empty-note">Au moins {MIN_LENGTH} caractères.</p>
            {formError && <div className="gpx-error-box gpx-recovery-box" role="alert"><AlertCircle size={16} /><span>{formError}</span></div>}
            <div className="gpx-cloud-form-actions">
              <button className="gpx-btn-primary" type="submit" disabled={busy}>
                <KeyRound size={15} /> {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
              </button>
            </div>
          </form>
        )}

        {phase === "ready" && done && (
          <>
            <div className="gpx-save-banner gpx-recovery-box" role="status">
              <CheckCircle2 size={16} />
              <span>Mot de passe modifié. Tu es connecté avec ce compte.</span>
            </div>
            <button className="gpx-btn-primary" onClick={onDone}>Continuer</button>
          </>
        )}
      </div>
    </div>
  );
}
