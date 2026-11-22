import { css, html, nothing, type TemplateResult } from 'lit';

import { translate } from '../translate';

// A form's own refusal is said inside the form, under the field it refuses, as a state of the form rather
// than as a notice over the screen; it stands until the field is changed. Its words are the editor's own,
// answered through the translator as the rest of the editor's chrome is.

export const formRefusalStyles = css`
  .form-refusal {
    width: 100%;
    margin-top: 4px;
    color: var(--affine-error-color);
    font-size: var(--affine-font-sm);
    line-height: 22px;
  }
`;

/** The line a form says when it refuses what was written in it, or nothing where it refuses nothing. */
export function formRefusal(
  said: string | null
): TemplateResult | typeof nothing {
  if (said === null) {
    return nothing;
  }

  return html`<div class="form-refusal" role="alert">${translate(said)}</div>`;
}
