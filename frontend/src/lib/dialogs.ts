/**
 * In-DOM replacements for window.prompt / window.confirm.
 * Electron does not support native prompt/confirm reliably.
 */

function styleOverlay(el: HTMLElement) {
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.55)', 'padding:1rem',
  ].join(';');
}

function stylePanel(el: HTMLElement) {
  el.style.cssText = [
    'background:#16142a', 'color:#f5f2e8', 'border-radius:12px',
    'padding:1.25rem 1.5rem', 'max-width:22rem', 'width:100%',
    'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
    'font-family:system-ui,sans-serif',
  ].join(';');
}

function styleBtn(el: HTMLButtonElement, primary: boolean) {
  el.type = 'button';
  el.style.cssText = primary
    ? 'padding:0.4rem 0.8rem;border-radius:8px;border:none;background:#c9a227;color:#0b0a1a;cursor:pointer;font-weight:600'
    : 'padding:0.4rem 0.8rem;border-radius:8px;border:none;background:#2a2740;color:#f5f2e8;cursor:pointer';
}

export function askText(message: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    styleOverlay(overlay);

    const panel = document.createElement('div');
    stylePanel(panel);

    const title = document.createElement('p');
    title.textContent = message;
    title.style.cssText = 'margin:0 0 0.75rem;font-weight:600;white-space:pre-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue;
    input.autocomplete = 'off';
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'padding:0.55rem 0.7rem',
      'border-radius:8px', 'border:1px solid #3a3658',
      'background:#0b0a1a', 'color:#f5f2e8', 'margin-bottom:0.85rem',
    ].join(';');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end';

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    styleBtn(cancel, false);

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    styleBtn(ok, true);

    const finish = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    cancel.onclick = () => finish(null);
    ok.onclick = () => {
      const value = input.value.trim();
      finish(value || null);
    };
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') ok.click();
      if (ev.key === 'Escape') cancel.click();
    };

    row.append(cancel, ok);
    panel.append(title, input, row);
    overlay.append(panel);
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    styleOverlay(overlay);

    const panel = document.createElement('div');
    stylePanel(panel);

    const title = document.createElement('p');
    title.textContent = message;
    title.style.cssText = 'margin:0 0 1rem;font-weight:600;white-space:pre-wrap';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:0.5rem;justify-content:flex-end';

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    styleBtn(cancel, false);

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    styleBtn(ok, true);

    const finish = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };

    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') finish(false);
      if (ev.key === 'Enter') finish(true);
    });

    row.append(cancel, ok);
    panel.append(title, row);
    overlay.append(panel);
    document.body.append(overlay);
    ok.focus();
  });
}

/** Multi-button chooser (e.g. Replace vs Fill). Returns choice id or null if cancelled. */
export function askChoice(
  message: string,
  choices: Array<{ id: string; label: string; primary?: boolean }>,
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    styleOverlay(overlay);

    const panel = document.createElement('div');
    stylePanel(panel);
    panel.style.maxWidth = '26rem';

    const title = document.createElement('p');
    title.textContent = message;
    title.style.cssText = 'margin:0 0 1rem;font-weight:600;white-space:pre-wrap';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:flex-end';

    const finish = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    styleBtn(cancel, false);
    cancel.onclick = () => finish(null);
    row.append(cancel);

    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.textContent = choice.label;
      styleBtn(btn, !!choice.primary);
      btn.onclick = () => finish(choice.id);
      row.append(btn);
    }

    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') finish(null);
    });

    panel.append(title, row);
    overlay.append(panel);
    document.body.append(overlay);
    cancel.focus();
  });
}
