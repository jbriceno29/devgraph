import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { InceptionIpcClient, InceptionProposalDto, InceptionQuestionDto, InceptionViewDto } from '../../src/shared/contracts/inception-view.js';

/** Datos parecidos a la corrida real: 3 preguntas, stack Node sin dependencias, ADR con 3 alternativas, Fundación y 2 features que dependen de ella, 7 tareas. */
export const questions:InceptionQuestionDto[]=[
 {id:'q1',text:'¿Quién va a usar la app?',options:['Solo yo','Un equipo pequeño'],default:'Solo yo',why:'Define si hace falta gestionar usuarios.'},
 {id:'q2',text:'¿Dónde se ejecuta?',options:['En la terminal','En el navegador'],default:'En la terminal',why:'Fija la plataforma y el stack.'},
 {id:'q3',text:'¿Cuándo está terminado?',options:['Crear, listar y completar tareas','Además, etiquetas y fechas'],default:null,why:'Evita sobrediseñar.'},
];
export const proposal:InceptionProposalDto={
 changeSetId:'cs-1',title:'Inicio: lista de tareas en la terminal',rationale:'Lo más simple que cumple el objetivo.',status:'VALIDATED',issues:[],
 decisionReasons:['Cambiar los cimientos del proyecto: objetivo, alcance, stack, reglas o comandos de verificación: siempre pide tu aprobación.'],
 profile:{description:'CLI personal para gestionar tareas en un archivo JSON local.',objectives:['Crear, listar y completar tareas','Guardar en un archivo local'],outOfScope:['Sincronización en la nube','Interfaz gráfica'],techStack:{lenguaje:'JavaScript (Node 20, ESM)',pruebas:'node --test',dependencias:'ninguna'},rules:['Identificadores en inglés; textos al usuario en español','Módulos ESM en src/; pruebas en test/'],verificationCommands:['node --test']},
 decision:{title:'ADR-001: Node sin dependencias',alternativesMd:'1. **Node sin dependencias** (elegida)\n2. **Python con Click**\n3. **Go con Cobra**',decisionMd:'Node 20 con la biblioteca estándar.',consequencesMd:'Sin `npm install`; menos ergonomía en el parseo de argumentos.'},
 documents:[{title:'Visión',relativePath:'docs/VISION.md'},{title:'Arquitectura',relativePath:'docs/ARCHITECTURE.md'},{title:'ADR-001',relativePath:'docs/adr/ADR-001.md'}],
 requirements:['Añadir una tarea con título','Listar tareas pendientes','Marcar una tarea como hecha'],
 features:[
  {tempId:'f2',title:'Gestión de tareas',isFoundation:false,dependsOn:['f1'],tasks:[{tempId:'t3',title:'Añadir tareas',initialStatus:'BLOCKED'},{tempId:'t4',title:'Listar tareas',initialStatus:'BLOCKED'},{tempId:'t5',title:'Completar tareas',initialStatus:'BLOCKED'}]},
  {tempId:'f1',title:'Fundación',isFoundation:true,dependsOn:[],tasks:[{tempId:'t2',title:'Persistencia en JSON',initialStatus:'BLOCKED'},{tempId:'t1',title:'Preparar el proyecto',initialStatus:'READY'}]},
  {tempId:'f3',title:'Interfaz de línea de comandos',isFoundation:false,dependsOn:['f1'],tasks:[{tempId:'t6',title:'Comandos y ayuda',initialStatus:'BLOCKED'},{tempId:'t7',title:'Mensajes de error',initialStatus:'BLOCKED'}]},
 ],
 scaffoldTaskTitle:'Preparar el proyecto',
};
export const notStarted:InceptionViewDto={projectId:'p',stage:'NOT_STARTED',status:'IDLE',nextAction:'START',brief:'',questions:[],answers:[],assumptions:[],proposal:null,error:null,model:null,repositoryPath:null,usage:{calls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,costUsd:null},notes:[],scaffoldTaskId:null,updatedAt:null};
export const usage2={calls:2,inputTokens:9000,outputTokens:3000,cacheReadTokens:0,cacheCreationTokens:0,costUsd:0.043};

/** Cliente `inception` falso con estado: start/answer responden WORKING y `emit` simula el aviso del motor.
 *  Todo resuelve en el siguiente microtask (sin temporizadores) y `emit` va siempre dentro de `act`, para que React procese el aviso
 *  antes de la siguiente línea de la prueba aunque quien llame olvide envolverlo. */
export function fakeInception(initial:Partial<InceptionViewDto>={}) {
 let view:InceptionViewDto={...notStarted,...initial};
 const listeners=new Set<(event:{projectId:string;stage:InceptionViewDto['stage'];status:InceptionViewDto['status']})=>void>();
 const set=(patch:Partial<InceptionViewDto>)=>{view={...view,...patch};return view;};
 const emit=(patch:Partial<InceptionViewDto>)=>{set(patch);act(()=>{for(const listener of [...listeners])listener({projectId:view.projectId,stage:view.stage,status:view.status});});};
 const client:InceptionIpcClient={
  get:vi.fn(async()=>view),
  start:vi.fn(async(_projectId,input)=>set({stage:'ASK_GOALS',status:'WORKING',nextAction:'WAIT',brief:input.brief,model:input.model??null,error:null,updatedAt:new Date().toISOString()})),
  answer:vi.fn(async(_projectId,answers,_notes?:string)=>set({status:'WORKING',nextAction:'WAIT',answers,error:null,updatedAt:new Date().toISOString()})),
  approve:vi.fn(async()=>set({stage:'APPLIED',status:'DONE',nextAction:'DONE',proposal:view.proposal&&{...view.proposal,status:'APPLIED'}})),
  restart:vi.fn(async()=>set({...notStarted,repositoryPath:view.repositoryPath})),
  initializeRepository:vi.fn(async(projectId,localPath)=>{set({repositoryPath:localPath});return {projectId,localPath,initialCommit:'abc1234def5678',files:['README.md','.gitignore','docs/']};}),
  onUpdated:vi.fn(listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}),
 };
 return {client,emit,current:()=>view};
}
