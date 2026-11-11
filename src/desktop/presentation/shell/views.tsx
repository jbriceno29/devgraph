import type { ReactNode } from 'react';
import type { ShellView } from './next-step.js';

const icon=(path:ReactNode)=><svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
export interface ViewInfo { id:ShellView; label:string; title:string; description:string; icon:ReactNode }
/** Vistas del shell en orden de atajo (⌘/Ctrl+1…6). */
export const VIEWS:ViewInfo[]=[
 {id:'activity',label:'Actividad',title:'Actividad',description:'Lo que necesita tu decisión, lo que está en curso y lo último que pasó.',icon:icon(<><path d="M2 9h3l1.5-4 3 7L11 9h3"/></>)},
 {id:'graph',label:'Grafo',title:'Grafo del proyecto',description:'Explora módulos, features y tareas; elige un nodo para ver su detalle y cambiar su estado.',icon:icon(<><circle cx="4" cy="4" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="7" cy="12" r="1.8"/><path d="M5.6 4.3l4.6.5M5 5.6l1.4 4.7M10.8 6.4L8.2 10.6"/></>)},
 {id:'planning',label:'Planificar',title:'Planificar',description:'Describe qué quieres construir; el motor propone cambios al plan y tú decides cuáles aplicar.',icon:icon(<><path d="M3 2.5h7l3 3v8H3z"/><path d="M5.5 8h5M5.5 10.5h3.5"/></>)},
 {id:'agents',label:'Agentes',title:'Agentes',description:'Ejecuta tareas listas con un agente, sigue su progreso y revisa el resultado.',icon:icon(<><rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2.5V5M6 9h.01M10 9h.01"/></>)},
 {id:'documents',label:'Documentos',title:'Documentos',description:'Especificaciones y notas del proyecto, sincronizadas con el repositorio.',icon:icon(<><path d="M4 2h5.5L12 4.5V14H4z"/><path d="M9.5 2v2.5H12"/></>)},
 {id:'inception',label:'Inicio',title:'Inicio del proyecto',description:'Un asistente define contigo el objetivo, el stack y el plan inicial. No se crea nada hasta que lo apruebes.',icon:icon(<><path d="M4 14V2.5"/><path d="M4 3h7.5l-1.8 2.75L11.5 8.5H4"/></>)},
];
export const viewInfo=(id:ShellView)=>VIEWS.find(view=>view.id===id)!;
export const isMac=()=>typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
export const shortcutLabel=(index:number)=>`${isMac()?'⌘':'Ctrl+'}${index+1}`;
