// The client's one entry. Both stylesheets are global imports so the chrome reaches every
// component's markup (ARCHITECTURE §Styling).
import { mount } from 'svelte';
import '@quillmark/svelte/preset';
import './studio.css';
import Studio from './Studio.svelte';

const target = document.getElementById('studio');
if (!target) throw new Error('studio: #studio mount point missing from index.html');

mount(Studio, { target });
