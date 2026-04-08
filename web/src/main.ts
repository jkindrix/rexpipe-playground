// Entry point for the rexpipe-playground frontend.
//
// Mounts the root App component and exports the mount handle for
// potential HMR. The Web Worker and WASM bridge are lazily initialized
// the first time a component imports them (specifically, the bridge
// singleton is constructed on first import of wasm-bridge.ts).

import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Could not find #app element in index.html');
}

const app = mount(App, { target });

export default app;
