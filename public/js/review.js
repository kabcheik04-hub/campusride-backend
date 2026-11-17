// Fenêtre « Votre avis » (écran F6 du pitch) : note de 1 à 5 + commentaire

import { attachForm, errorSummaryHtml } from './forms.js';
import { avatar, esc, shortName } from './ui.js';

/** Retourne { rating, comment } si l'avis est envoyé, sinon null. */
export function askReview({ name, photo, line }) {
  const dialog = document.getElementById('review-dialog');
  dialog.setAttribute('aria-labelledby', 'review-title');
  dialog.innerHTML = `
    <form novalidate>
      <h2 id="review-title">Votre avis</h2>
      <div class="person">
        ${avatar(name, photo, 'lg')}
        <div><p class="person-name">${esc(shortName(name))}</p><p class="muted">${esc(line)}</p></div>
      </div>
      ${errorSummaryHtml()}
      <fieldset class="field" data-required-message="Choisissez une note de 1 à 5">
        <legend>Note de 1 à 5</legend>
        <div class="rating">
          ${[5, 4, 3, 2, 1]
            .map(
              (n) => `<input type="radio" name="rating" id="f-rating-${n}" value="${n}" required aria-describedby="f-rating-error">
          <label for="f-rating-${n}"><span class="sr-only">${n} sur 5</span><span aria-hidden="true">${n}</span></label>`,
            )
            .join('')}
        </div>
        <p class="rating-readout" aria-live="polite"></p>
        <p class="field-error" id="f-rating-error" hidden></p>
      </fieldset>
      <div class="field">
        <label for="f-comment">Commentaire <span class="opt">(facultatif)</span></label>
        <textarea id="f-comment" name="comment" rows="3" maxlength="500"></textarea>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-cancel>Annuler</button>
        <button type="submit" class="btn btn-primary">Envoyer</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form');
  const readout = dialog.querySelector('.rating-readout');
  form.addEventListener('change', (event) => {
    if (event.target.name === 'rating') readout.textContent = `Note choisie : ${event.target.value} sur 5`;
  });

  let result = null;
  attachForm(form, async (values) => {
    result = { rating: Number(values.rating), comment: values.comment?.trim() || undefined };
    dialog.close('ok');
  });
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));

  dialog.returnValue = '';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? result : null), { once: true });
    dialog.showModal();
  });
}
