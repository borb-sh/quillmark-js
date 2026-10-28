// The app client's one entry. `loadApp` links the author's `app.css` after both sheets here.
import { mount } from 'svelte';
import '@quillmark/svelte/preset';
import './chrome.css';
import App from './App.svelte';
import { loadApp } from './config';

const target = document.getElementById('app');
if (!target) throw new Error('app: #app mount point missing from index.html');

loadApp().then(
	(app) => mount(App, { target, props: { app } }),
	(err: unknown) => {
		const said = document.createElement('p');
		said.className = 'qm-status qm-status-error';
		said.setAttribute('role', 'alert');
		said.textContent = "This app can't load right now.";
		target.append(said);
		console.error(err);
	}
);
