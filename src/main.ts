import './style.css';
import { bindWaitlist } from './forms/waitlist.ts';
import { mountOverlay } from './overlay.ts';
import { bootstrapSimulation } from './simulation.ts';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function reqHost(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`required element ${selector}`);
  }
  return el;
}

document.documentElement.classList.add('js-loaded');

const uiMount = reqHost('#ui-root');
const pixMount = reqHost('#pixi-root');
const staticFallback = reqHost('#static-fallback');

mountOverlay(uiMount);
bindWaitlist(uiMount);

let disposeSimulation: (() => Promise<void>) | undefined;

function applyReducedUi(enabled: boolean) {
  document.body.classList.toggle('reduced-motion', enabled);
  pixMount.hidden = enabled;
  staticFallback.hidden = !enabled;
}

async function startSimulation() {
  await disposeSimulation?.();
  disposeSimulation = await bootstrapSimulation(pixMount).catch(async (err) => {
    console.error(err);
    return async () => {
      /** noop teardown */
    };
  });
}

async function stopSimulation() {
  await disposeSimulation?.();
  disposeSimulation = undefined;
}

applyReducedUi(mq?.matches === true);

if (!mq?.matches) {
  void startSimulation();
}

mq?.addEventListener('change', (evt) => {
  applyReducedUi(evt.matches);
  if (evt.matches) {
    void stopSimulation();
  } else {
    void startSimulation();
  }
});
