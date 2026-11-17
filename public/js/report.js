// Fenêtre « Signaler » : motif obligatoire + précisions facultatives

import { attachForm, errorSummaryHtml } from './forms.js';
import { esc } from './ui.js';

export const REASONS = {
  inappropriate: 'Contenu ou comportement inapproprié',
  dangerous: 'Comportement dangereux',
  fraud: 'Fraude ou arnaque',
  spam: 'Spam',
  other: 'Autre motif',
};

/** Retourne { reason, details } si le signalement est validé, sinon null. */
export function askReport({ title, subject }) {
  const dialog = document.getElementById('report-dialog');
  dialog.setAttribute('aria-labelledby', 'report-title-dialog');
  dialog.innerHTML = `
    <form novalidate>
      <h2 id="report-title-dialog">${esc(title)}</h2>
      <p class="muted">${esc(subject)}</p>
      ${errorSummaryHtml()}
      <div class="field">
        <label for="f-reason">Motif</label>
        <select id="f-reason" name="reason" required aria-describedby="f-reason-error">
          <option value="" selected disabled>Choisir un motif</option>
          ${Object.entries(REASONS)
            .map(([value, label]) => `<option value="${value}">${esc(label)}</option>`)
            .join('')}
        </select>
        <p class="field-error" id="f-reason-error" hidden></p>
      </div>
      <div class="field">
        <label for="f-details">Précisions <span class="opt">(facultatif)</span></label>
        <textarea id="f-details" name="details" rows="3" maxlength="500"></textarea>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-danger">Envoyer le signalement</button>
      </div>
    </form>`;

  let result = null;
  attachForm(dialog.querySelector('form'), async (values) => {
    result = { reason: values.reason, details: values.details?.trim() || undefined };
    dialog.close('ok');
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));

  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? result : null), { once: true });
    dialog.showModal();
  });
}
