// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InceptionAssistant } from '@desktop/presentation/inception/InceptionAssistant.js';
import { WorkspaceNavigationProvider } from '@desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '@desktop/state/WorkspaceShell.js';
import type { GraphNodeView } from '../../src/shared/contracts/graph-view.js';
import { installShellIpc } from './shell-ipc.js';
import { fakeInception, proposal, questions, usage2 } from './inception-fake.js';

const root:GraphNodeView={id:'root',key:'PROJ-01',type:'PROJECT_ROOT',label:'Example Workspace',status:'ACTIVE'};
const applied:GraphNodeView[]=[root,{id:'f1',key:'FEAT-001',type:'FEATURE',label:'Fundación',status:'DRAFT',parentId:'root'},{id:'t1',key:'TASK-001',type:'WORK_ITEM',label:'Preparar el proyecto',status:'READY',parentId:'f1'}];
const profile={id:'dev',projectId:'p',roleKey:'DEVELOPER',name:'Dev',defaultProviderId:null,providerId:'claude',providerName:'Claude Code',capabilities:{},defaultModel:'sonnet',planningModel:'opus',availableModels:['haiku','sonnet','opus']};
afterEach(()=>{cleanup();vi.restoreAllMocks();});

function setup(initial:Parameters<typeof fakeInception>[0]={},nodes:GraphNodeView[]=[root],withInception=true){
 const ipc=installShellIpc(nodes);
 (ipc.queries.listAgentProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([profile]);
 const fake=fakeInception(initial);
 if(withInception)ipc.inception=fake.client;
 const onNavigate=vi.fn(),onApplied=vi.fn();
 const view=render(<InceptionAssistant projectId="p" nodes={nodes} onNavigate={onNavigate} onApplied={onApplied}/>);
 return {...fake,ipc,onNavigate,onApplied,view};
}
const currentStep=()=>within(screen.getByRole('list',{name:'Pasos del inicio'})).getAllByRole('listitem').find(item=>item.getAttribute('aria-current')==='step')!;

describe('Asistente de inicio',()=>{
 it('runs the whole flow: brief → questions → answers → proposal → confirm → ready, moving focus to each new step',async()=>{
  const {client,emit,onNavigate,onApplied,view}=setup({repositoryPath:'/home/ana/app'});
  expect(await screen.findByRole('heading',{name:'Cuéntanos tu idea'})).toBeTruthy();
  expect(currentStep().textContent).toMatch(/Objetivo y alcance/);
  await waitFor(()=>expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('opus'));
  expect(screen.getByRole('option',{name:'opus (recomendado)'})).toBeTruthy();
  expect(screen.getByText(/unos centavos de dólar/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Empezar'}));
  expect(screen.getByRole('alert').textContent).toMatch(/Describe en pocas líneas/);
  expect(client.start).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('¿Qué quieres construir?'),{target:{value:'Una lista de tareas para la terminal'}});
  fireEvent.click(screen.getByRole('button',{name:'Empezar'}));
  await waitFor(()=>expect(client.start).toHaveBeenCalledWith('p',{brief:'Una lista de tareas para la terminal',model:'opus'}));
  const thinking=await screen.findByRole('heading',{name:'Pensando el objetivo…'});
  expect(document.activeElement).toBe(thinking);
  expect(screen.getByRole('status').textContent).toMatch(/preparando unas pocas preguntas/);

  act(()=>emit({status:'WAITING_USER',nextAction:'ANSWER',questions,usage:{...usage2,calls:1,costUsd:0.012}}));
  const asking=await screen.findByRole('heading',{name:'Unas preguntas antes de proponer'});
  await waitFor(()=>expect(document.activeElement).toBe(asking));
  expect(screen.getByText(/Una lista de tareas para la terminal/)).toBeTruthy();
  const first=screen.getByRole('group',{name:'1. ¿Quién va a usar la app?'});
  expect(within(first).getByText('Recomendada').closest('label')!.textContent).toMatch(/Solo yo/);
  expect(first.getAttribute('aria-describedby')).toBeTruthy();
  expect(within(first).getByText(/Define si hace falta gestionar usuarios/)).toBeTruthy();
  fireEvent.click(within(first).getByRole('radio',{name:/Un equipo pequeño/}));
  const third=screen.getByRole('group',{name:'3. ¿Cuándo está terminado?'});
  fireEvent.click(within(third).getByRole('radio',{name:'Otra respuesta'}));
  fireEvent.change(within(third).getByLabelText('Tu respuesta a la pregunta 3'),{target:{value:'Solo crear y listar'}});
  expect(screen.getByText(/1 llamada al motor · costo estimado: unos US\$ 0,01/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Enviar respuestas'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',[{questionId:'q1',answer:'Un equipo pequeño'},{questionId:'q2',answer:''},{questionId:'q3',answer:'Solo crear y listar'}]));
  expect(await screen.findByRole('heading',{name:'Preparando la propuesta, puede tardar un minuto'})).toBeTruthy();

  act(()=>emit({stage:'PROPOSAL',status:'WAITING_USER',nextAction:'APPROVE',proposal,assumptions:['Un solo usuario local'],usage:usage2}));
  const review=await screen.findByRole('heading',{name:proposal.title});
  await waitFor(()=>expect(document.activeElement).toBe(review));
  expect(currentStep().textContent).toMatch(/Revisar propuesta/);
  for(const name of ['Resumen del proyecto','Stack elegido','Reglas del proyecto','Cómo se verificará','Documentos que se crearán','Requisitos','Plan'])expect(screen.getByRole('region',{name})).toBeTruthy();
  expect(screen.getByText('Un solo usuario local')).toBeTruthy();
  expect(screen.getByText('Alternativas consideradas').closest('details')!.open).toBe(false);
  const plan=screen.getByRole('region',{name:'Plan'});
  expect(within(plan).getByText('3 features con 7 tareas.')).toBeTruthy();
  const features=within(plan).getAllByRole('listitem').filter(item=>item.parentElement?.parentElement===plan.lastElementChild);
  expect(features.map(item=>item.querySelector('p')!.textContent)).toEqual(['Fundación','Gestión de tareas','Interfaz de línea de comandos']);
  expect(within(plan).getAllByText('Empieza cuando termine Fundación')).toHaveLength(2);
  expect(within(features[0]!).getAllByRole('listitem')[0]!.textContent).toMatch(/Preparar el proyectoPrimera tarea/);
  expect(screen.getByText(/siempre pide tu aprobación/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button',{name:'Aprobar y crear el plan'}));
  const confirm=await screen.findByRole('heading',{name:'¿Crear el plan?'});
  await waitFor(()=>expect(document.activeElement).toBe(confirm));
  expect(screen.getByText('3 features y 7 tareas.')).toBeTruthy();
  expect(screen.getByText(/docs\/VISION\.md, docs\/ARCHITECTURE\.md/)).toBeTruthy();
  expect(client.approve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Sí, crear el plan'}));
  await waitFor(()=>expect(client.approve).toHaveBeenCalledWith('p'));
  expect(onApplied).toHaveBeenCalled();
  view.rerender(<InceptionAssistant projectId="p" nodes={applied} onNavigate={onNavigate} onApplied={onApplied}/>);
  expect(await screen.findByRole('heading',{name:'Proyecto listo'})).toBeTruthy();
  expect(currentStep().textContent).toMatch(/Listo/);
  expect(screen.getByText('Ejecuta la primera tarea: Preparar el proyecto')).toBeTruthy();
  expect(screen.getByRole('region',{name:'Documentos creados'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Ir a la primera tarea'}));
  expect(onNavigate).toHaveBeenCalledWith({view:'agents',workItemId:'t1'});
 });

 it('«Decide tú» is the default and sends empty answers; an empty free answer is flagged',async()=>{
  const {client}=setup({stage:'ASK_GOALS',status:'WAITING_USER',nextAction:'ANSWER',brief:'Idea',questions});
  await screen.findByRole('heading',{name:'Unas preguntas antes de proponer'});
  const second=screen.getByRole('group',{name:'2. ¿Dónde se ejecuta?'});
  expect((within(second).getByRole('radio',{name:/Decide tú/}) as HTMLInputElement).checked).toBe(true);
  expect(within(second).getByText('Usará la recomendada: «En la terminal».')).toBeTruthy();
  expect(within(screen.getByRole('group',{name:'3. ¿Cuándo está terminado?'})).getByText('El asistente elegirá la opción más sencilla.')).toBeTruthy();
  fireEvent.click(within(second).getByRole('radio',{name:'Otra respuesta'}));
  fireEvent.click(screen.getByRole('button',{name:'Enviar respuestas'}));
  expect(within(second).getByRole('alert').textContent).toMatch(/Escribe tu respuesta/);
  expect(within(second).getByLabelText('Tu respuesta a la pregunta 2').getAttribute('aria-invalid')).toBe('true');
  expect(client.answer).not.toHaveBeenCalled();
  fireEvent.click(within(second).getByRole('radio',{name:/Decide tú/}));
  fireEvent.click(screen.getByRole('button',{name:'Enviar respuestas'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',questions.map(question=>({questionId:question.id,answer:''}))));
 });

 it('creates a new repository with the same path validation as Documentos',async()=>{
  const {client,onNavigate}=setup();
  await screen.findByRole('heading',{name:'Cuéntanos tu idea'});
  fireEvent.click(screen.getByText('Crear un repositorio nuevo (opcional)'));
  const input=screen.getByLabelText('Ruta de la carpeta nueva o vacía'),create=screen.getByRole('button',{name:'Crear el repositorio'});
  expect(input.getAttribute('aria-describedby')).toMatch(/help/);
  for(const [value,message] of [['','Escribe la ruta'],['~/proyectos/app','«~» no se expande'],['https://github.com/ana/app','URL remota'],['proyectos/app','debe ser absoluta']] as const){
   fireEvent.change(input,{target:{value}});fireEvent.click(create);
   expect(screen.getByRole('alert').textContent).toContain(message);expect(input.getAttribute('aria-invalid')).toBe('true');
  }
  expect(client.initializeRepository).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:' "/home/ana/proyectos/app/" '}});fireEvent.click(create);
  await waitFor(()=>expect(client.initializeRepository).toHaveBeenCalledWith('p','/home/ana/proyectos/app'));
  expect((await screen.findByText(/Repositorio creado en/)).closest('[role=status]')!.textContent).toMatch(/abc1234 \(README\.md, \.gitignore, docs\/\)/);
  await waitFor(()=>expect(screen.getByText(/Repositorio del proyecto:/).textContent).toMatch(/\/home\/ana\/proyectos\/app/));
  expect(onNavigate).not.toHaveBeenCalled();
 });

 it('blocks approval without a repository or with issues, explaining why, and asks for another proposal',async()=>{
  const {client,emit}=setup({stage:'PROPOSAL',status:'WAITING_USER',nextAction:'SET_UP_REPOSITORY',brief:'Idea',questions,answers:[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:''},{questionId:'q3',answer:'Algo propio'}],proposal});
  const approve=await screen.findByRole('button',{name:'Aprobar y crear el plan'});
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById(approve.getAttribute('aria-describedby')!)!.textContent).toMatch(/Falta el repositorio Git/);
  expect(screen.getByRole('heading',{name:'Crear un repositorio nuevo'})).toBeTruthy();
  act(()=>emit({repositoryPath:'/home/ana/app',nextAction:'REVISE_PROPOSAL',proposal:{...proposal,status:'PENDING_APPROVAL',issues:['La feature Fundación no tiene tareas.']}}));
  expect(await screen.findByText('La feature Fundación no tiene tareas.')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/Avisos de la propuesta/);
  expect((screen.getByRole('button',{name:'Aprobar y crear el plan'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Pedir otra propuesta'}));
  expect(await screen.findByRole('heading',{name:'Pedir otra propuesta'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Cambiar mis respuestas'}));
  expect(await screen.findByRole('heading',{name:'Cambiar tus respuestas'})).toBeTruthy();
  expect((within(screen.getByRole('group',{name:'1. ¿Quién va a usar la app?'})).getByRole('radio',{name:/^Solo yo/}) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Tu respuesta a la pregunta 3') as HTMLInputElement).value).toBe('Algo propio');
  fireEvent.click(screen.getByRole('button',{name:'Generar otra propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:''},{questionId:'q3',answer:'Algo propio'}]));
 });

 it('«Pedir otra propuesta» asks what to change and regenerates with the same answers, without going through the questions',async()=>{
  const answers=[{questionId:'q1',answer:'Solo yo'},{questionId:'q2',answer:''},{questionId:'q3',answer:''}];
  const {client,emit}=setup({stage:'PROPOSAL',status:'WAITING_USER',nextAction:'APPROVE',brief:'Idea',repositoryPath:'/home/ana/app',questions,answers,proposal,notes:['Sin base de datos']});
  expect(await screen.findByText('Sin base de datos')).toBeTruthy();
  expect(screen.getByText('Esta propuesta tiene en cuenta lo que pediste')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Pedir otra propuesta'}));
  const title=await screen.findByRole('heading',{name:'Pedir otra propuesta'});
  await waitFor(()=>expect(document.activeElement).toBe(title));
  expect(screen.queryByRole('group',{name:/¿Quién va a usar la app\?/})).toBeNull();
  expect(screen.getByText(/Ya pediste/).parentElement!.textContent).toMatch(/Sin base de datos/);
  const field=screen.getByLabelText('¿Qué quieres cambiar?') as HTMLTextAreaElement;
  expect(field.maxLength).toBe(2000);expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toMatch(/0\/2000/);
  fireEvent.change(field,{target:{value:'  Usa Python en lugar de Node  '}});
  expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toMatch(/31\/2000/);
  fireEvent.click(screen.getByRole('button',{name:'Generar otra propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',answers,'Usa Python en lugar de Node'));
  expect(await screen.findByRole('heading',{name:'Preparando la propuesta, puede tardar un minuto'})).toBeTruthy();
  act(()=>emit({status:'WAITING_USER',nextAction:'APPROVE',notes:['Sin base de datos','Usa Python en lugar de Node']}));
  expect(await screen.findByText('Usa Python en lugar de Node')).toBeTruthy();
  // «Volver a la propuesta» no llama al motor; vacío vuelve a intentarlo con lo mismo.
  fireEvent.click(screen.getByRole('button',{name:'Pedir otra propuesta'}));
  fireEvent.click(await screen.findByRole('button',{name:'Volver a la propuesta'}));
  expect(await screen.findByRole('heading',{name:proposal.title})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Pedir otra propuesta'}));
  fireEvent.click(await screen.findByRole('button',{name:'Generar otra propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenLastCalledWith('p',answers,''));
 });

 it('«Proyecto listo» opens Agentes with the scaffold task by id, and falls back to its title',async()=>{
  const {onNavigate,view}=setup({stage:'APPLIED',status:'DONE',nextAction:'DONE',proposal:{...proposal,status:'APPLIED'},scaffoldTaskId:'t-real'},applied);
  expect(await screen.findByRole('heading',{name:'Proyecto listo'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Ir a la primera tarea'}));
  expect(onNavigate).toHaveBeenCalledWith({view:'agents',workItemId:'t-real'});
  view.unmount();
  const fallback=setup({stage:'APPLIED',status:'DONE',nextAction:'DONE',proposal:{...proposal,status:'APPLIED'},scaffoldTaskId:null},applied);
  fireEvent.click(await screen.findByRole('button',{name:'Ir a la primera tarea'}));
  expect(fallback.onNavigate).toHaveBeenCalledWith({view:'agents',workItemId:'t1'});
 });

 it('FAILED shows the reason and the right retry; «Empezar de nuevo» asks first',async()=>{
  const {client,emit}=setup({stage:'ASK_GOALS',status:'FAILED',nextAction:'RETRY_QUESTIONS',brief:'Idea',model:'sonnet',error:'connect ECONNREFUSED 127.0.0.1'});
  expect(await screen.findByRole('heading',{name:'No se pudo completar el paso'})).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toMatch(/No se pudo comunicar con el núcleo/);
  fireEvent.click(screen.getByRole('button',{name:'Reintentar las preguntas'}));
  await waitFor(()=>expect(client.start).toHaveBeenCalledWith('p',{brief:'Idea',model:'sonnet'}));
  act(()=>emit({stage:'PROPOSAL',status:'FAILED',nextAction:'RETRY_PROPOSAL',questions,answers:[{questionId:'q1',answer:''}],error:'El motor devolvió JSON inválido'}));
  fireEvent.click(await screen.findByRole('button',{name:'Reintentar la propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',[{questionId:'q1',answer:''}]));
  act(()=>emit({status:'FAILED',nextAction:'RETRY_PROPOSAL'}));
  const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(await screen.findByRole('button',{name:'Empezar de nuevo'}));
  expect(client.restart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Empezar de nuevo'}));
  await waitFor(()=>expect(client.restart).toHaveBeenCalledWith('p'));
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole('heading',{name:'Cuéntanos tu idea'})).toBeTruthy();
 });

 it('shows a calm «sigue trabajando» after two minutes, without an error, and polls as a fallback',async()=>{
  const {client}=setup({stage:'ASK_GOALS',status:'WORKING',nextAction:'WAIT',brief:'Idea',questions,updatedAt:new Date(Date.now()-150_000).toISOString()});
  expect(await screen.findByRole('heading',{name:'Preparando la propuesta, puede tardar un minuto'})).toBeTruthy();
  expect(screen.getByRole('status').textContent).toMatch(/Sigue trabajando/);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/Lleva 2 min/)).toBeTruthy();
  expect(client.onUpdated).toHaveBeenCalled();
 });

 it('without the inception client (older core) explains it and offers Planificar',async()=>{
  const {onNavigate}=setup({},[root],false);
  expect(screen.getByRole('heading',{name:'El asistente de inicio no está disponible'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Ir a Planificar'}));
  expect(onNavigate).toHaveBeenCalledWith({view:'planning'});
 });

 it('a project that already has a plan is not offered a fresh start',async()=>{
  setup({},applied);
  expect(await screen.findByRole('heading',{name:'Este proyecto ya tiene un plan'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Empezar'})).toBeNull();
 });
});

describe('Inicio en el shell',()=>{
 it('after creating a project the shell opens Inicio with the assistant',async()=>{
  const ipc=installShellIpc([root]);ipc.inception=fakeInception().client;
  render(<WorkspaceNavigationProvider><WorkspaceShell/></WorkspaceNavigationProvider>);
  fireEvent.change(await screen.findByLabelText('Nombre del proyecto'),{target:{value:'Mi app'}});
  fireEvent.click(screen.getByRole('button',{name:'Crear proyecto'}));
  await waitFor(()=>expect(ipc.commands.createProject).toHaveBeenCalledWith({name:'Mi app',slug:'mi-app'}));
  const tab=await screen.findByRole('tab',{name:/Inicio/});
  await waitFor(()=>expect(tab.getAttribute('aria-selected')).toBe('true'));
  expect(await screen.findByRole('heading',{name:'Cuéntanos tu idea'})).toBeTruthy();
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id);
 });
});
