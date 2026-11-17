// Formulaires accessibles : erreur sous chaque champ + résumé annoncé et ciblé au clavier

import { esc } from './ui.js';

/** Champ de saisie avec libellé visible, aide facultative et zone d'erreur liée par aria-describedby. */
export function fieldHtml({ name, label, type = 'text', required = true, hint = '', value = '', attrs = '', optional = false }) {
  const id = `f-${name}`;
  const describedBy = `${hint ? `${id}-hint ` : ''}${id}-error`;
  return `
    <div class="field">
      <label for="${id}">${esc(label)}${optional ? ' <span class="opt">(facultatif)</span>' : ''}</label>
      ${hint ? `<p class="hint" id="${id}-hint">${esc(hint)}</p>` : ''}
      <input id="${id}" name="${name}" type="${type}" ${required ? 'required' : ''} value="${esc(value)}" aria-describedby="${describedBy}" ${attrs}>
      <p class="field-error" id="${id}-error" hidden></p>
    </div>`;
}

export const errorSummaryHtml = () => '<div class="error-summary" role="alert" tabindex="-1" hidden></div>';

const errorElementFor = (el) => document.getElementById(el.type === 'radio' ? `f-${el.name}-error` : `${el.id}-error`);

/** Message court (sous le champ) et message complet avec le nom du champ (dans le résumé). */
function messageFor(el) {
  const label = (el.labels?.[0]?.textContent ?? el.name).replace(/\(.*?\)/g, '').trim();
  const v = el.validity;
  const withLabel = (short) => ({ short, full: `${label} : ${short.charAt(0).toLowerCase()}${short.slice(1)}` });

  if (v.valueMissing) {
    if (el.type === 'radio') {
      const message = el.closest('fieldset')?.dataset.requiredMessage ?? 'Choisissez une option';
      return { short: message, full: message };
    }
    return withLabel('Ce champ est obligatoire');
  }
  if (v.typeMismatch) {
    const message = el.type === 'email' ? 'Saisissez une adresse e-mail valide' : 'Saisissez une valeur valide';
    return { short: message, full: message };
  }
  if (v.tooShort) return withLabel(`Au moins ${el.minLength} caractères`);
  if (v.rangeUnderflow) return withLabel(`Minimum ${el.min}`);
  if (v.rangeOverflow) return withLabel(`Maximum ${el.max}`);
  return withLabel('Valeur invalide');
}

/**
 * Branche la validation et l'envoi d'un formulaire.
 * `onSubmit(valeurs)` peut lever une erreur : son message s'affiche dans le résumé d'erreurs.
 */
export function attachForm(form, onSubmit) {
  form.noValidate = true;
  const summary = form.querySelector('.error-summary');

  const clear = () => {
    summary.hidden = true;
    summary.innerHTML = '';
    form.querySelectorAll('.field-error').forEach((p) => {
      p.hidden = true;
      p.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  };
  const showSummary = (html) => {
    summary.innerHTML = html;
    summary.hidden = false;
    summary.focus();
  };

  summary.addEventListener('click', (event) => {
    const target = event.target.closest('[data-focus]');
    if (target) document.getElementById(target.dataset.focus)?.focus();
  });

  // Dès qu'un champ en erreur est corrigé, son message (et sa ligne du résumé) disparaît
  form.addEventListener('input', (event) => {
    const el = event.target;
    if (!el.name) return;
    const group = el.type === 'radio' ? [...form.querySelectorAll(`input[name="${el.name}"]`)] : [el];
    if (!group.some((g) => g.getAttribute('aria-invalid') === 'true') || !el.checkValidity()) return;
    for (const g of group) {
      g.removeAttribute('aria-invalid');
      summary.querySelector(`[data-focus="${g.id}"]`)?.closest('li')?.remove();
    }
    const errorEl = errorElementFor(el);
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (!summary.querySelector('li')) {
      summary.hidden = true;
      summary.innerHTML = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clear();

    const invalid = [...form.elements].filter((el) => el.willValidate && !el.checkValidity());
    if (invalid.length) {
      const seen = new Set();
      const items = [];
      for (const el of invalid) {
        const key = el.type === 'radio' ? el.name : el.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const { short, full } = messageFor(el);
        const errorEl = errorElementFor(el);
        if (errorEl) {
          errorEl.textContent = short;
          errorEl.hidden = false;
        }
        el.setAttribute('aria-invalid', 'true');
        items.push(`<li><button type="button" class="link-button" data-focus="${el.id}">${esc(full)}</button></li>`);
      }
      showSummary(`<h2>Veuillez corriger ${items.length > 1 ? 'ces champs' : 'ce champ'}</h2><ul>${items.join('')}</ul>`);
      return;
    }

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (error) {
      showSummary(`<h2>Impossible de continuer</h2><p>${esc(error.message)}</p>`);
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}
