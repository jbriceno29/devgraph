// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InceptionAssistant } from '@desktop/presentation/inception/InceptionAssistant.js';
import { WorkspaceNavigationProvider } from '@desktop/state/workspace-navigation-context.js';
import { WorkspaceShell } from '@desktop/state/WorkspaceShell.js';
import type { GraphNodeView } from '../../src/shared/contracts/graph-view.js';
import { installShellIpc } from './shell-ipc.js';
import { fakeInception, prototypeHtml, proposal, questions, uiOptions, usage2 } from './inception-fake.js';

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
  await waitFor(()=>expect(document.activeElement).toBe(thinking));
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
  await waitFor(()=>expect(onApplied).toHaveBeenCalled());
  view.rerender(<InceptionAssistant projectId="p" nodes={applied} onNavigate={onNavigate} onApplied={onApplied}/>);
  expect(await screen.findByRole('heading',{name:'Proyecto listo'})).toBeTruthy();
  expect(currentStep().textContent).toMatch(/Listo/);
  expect(screen.getByText('Ejecuta la primera tarea: Preparar el proyecto')).toBeTruthy();
  expect(screen.getByRole('region',{name:'Documentos creados'})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Ir a la primera tarea'}));
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
  fireEvent.click(await screen.findByRole('button',{name:'Pedir otra propuesta'}));
  expect(await screen.findByRole('heading',{name:'Pedir otra propuesta'})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Cambiar mis respuestas'}));
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
  fireEvent.click(await screen.findByRole('button',{name:'Pedir otra propuesta'}));
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
  fireEvent.click(await screen.findByRole('button',{name:'Pedir otra propuesta'}));
  fireEvent.click(await screen.findByRole('button',{name:'Volver a la propuesta'}));
  expect(await screen.findByRole('heading',{name:proposal.title})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Pedir otra propuesta'}));
  fireEvent.click(await screen.findByRole('button',{name:'Generar otra propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenLastCalledWith('p',answers,''));
 });

 it('«Proyecto listo» opens Agentes with the scaffold task by id, and falls back to its title',async()=>{
  const {onNavigate,view}=setup({stage:'APPLIED',status:'DONE',nextAction:'DONE',proposal:{...proposal,status:'APPLIED'},scaffoldTaskId:'t-real'},applied);
  expect(await screen.findByRole('heading',{name:'Proyecto listo'})).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Ir a la primera tarea'}));
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
  fireEvent.click(await screen.findByRole('button',{name:'Reintentar las preguntas'}));
  await waitFor(()=>expect(client.start).toHaveBeenCalledWith('p',{brief:'Idea',model:'sonnet'}));
  act(()=>emit({stage:'PROPOSAL',status:'FAILED',nextAction:'RETRY_PROPOSAL',questions,answers:[{questionId:'q1',answer:''}],error:'El motor devolvió JSON inválido'}));
  fireEvent.click(await screen.findByRole('button',{name:'Reintentar la propuesta'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',[{questionId:'q1',answer:''}]));
  act(()=>emit({status:'FAILED',nextAction:'RETRY_PROPOSAL'}));
  const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(await screen.findByRole('button',{name:'Empezar de nuevo'}));
  expect(client.restart).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button',{name:'Empezar de nuevo'}));
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

describe('Asistente de inicio: referencias',()=>{
 const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
 const file=(name:string,bytes:BlobPart[]=[PNG],type='image/png')=>new File(bytes,name,{type});
 const attach=async(...files:File[])=>{const input=await screen.findByLabelText('Adjuntar archivos') as HTMLInputElement;await act(async()=>{fireEvent.change(input,{target:{files}});});};
 const translated=(over:Record<string,unknown>={})=>({id:'ref-1',name:'panel.png',kind:'VISUAL' as const,note:'sin sombras',mimeType:'image/png',bytes:11,status:'TRANSLATED' as const,error:null,translation:{summary:'Panel con barra lateral y tarjetas.',palette:['azul #2255ff'],typography:'Sans-serif',layout:'Dos columnas',screens:[],actions:[],flows:[],states:[],ideas:[],openQuestions:['¿Modo oscuro?']},...over});

 it('attaches a file, asks what it is for, and sends it with the brief as base64 (image → visual by default)',async()=>{
  const {client}=setup();
  fireEvent.click(await screen.findByText(/Referencias \(opcional\)/));
  expect(screen.getByText(/no ve tus archivos/)).toBeTruthy();
  await attach(file('panel.png'),file('flujo.md',['# Flujo\n'],'text/markdown'));
  const list=await screen.findByRole('list',{name:'Referencias adjuntas'});
  const items=within(list).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect((within(items[0]!).getByLabelText('¿Para qué sirve?') as HTMLSelectElement).value).toBe('VISUAL');
  expect((within(items[1]!).getByLabelText('¿Para qué sirve?') as HTMLSelectElement).value).toBe('FUNCTIONAL');
  fireEvent.change(within(items[1]!).getByLabelText('¿Para qué sirve?'),{target:{value:'CONCEPTUAL'}});
  fireEvent.change(within(items[0]!).getByLabelText('Qué conservar o evitar (opcional)'),{target:{value:'sin sombras'}});
  expect(within(items[0]!).getByText(/no se tomarán como requisitos/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('¿Qué quieres construir?'),{target:{value:'Un panel de tareas'}});
  fireEvent.click(screen.getByRole('button',{name:'Empezar'}));
  await waitFor(()=>expect(client.start).toHaveBeenCalledTimes(1));
  const sent=(client.start as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {brief:string;references:Array<{name:string;kind:string;note:string;dataBase64:string}>};
  expect(sent.references.map(item=>[item.name,item.kind,item.note])).toEqual([['panel.png','VISUAL','sin sombras'],['flujo.md','CONCEPTUAL','']]);
  expect([...Buffer.from(sent.references[0]!.dataBase64,'base64')]).toEqual([...PNG]);
  expect(Buffer.from(sent.references[1]!.dataBase64,'base64').toString()).toBe('# Flujo\n');
  expect(Object.keys(sent.references[0]!).sort()).toEqual(['dataBase64','kind','name','note']);
 });

 it('removes a reference, and sends none when none is attached',async()=>{
  const {client}=setup();
  fireEvent.click(await screen.findByText(/Referencias \(opcional\)/));
  await attach(file('panel.png'));
  fireEvent.click(await screen.findByRole('button',{name:'Quitar panel.png'}));
  expect(screen.queryByRole('list',{name:'Referencias adjuntas'})).toBeNull();
  fireEvent.change(screen.getByLabelText('¿Qué quieres construir?'),{target:{value:'Un panel'}});
  fireEvent.click(screen.getByRole('button',{name:'Empezar'}));
  await waitFor(()=>expect(client.start).toHaveBeenCalledWith('p',expect.not.objectContaining({references:expect.anything()})));
 });

 it('refuses unsupported types, big files and more than five, explaining why and attaching nothing',async()=>{
  setup();
  fireEvent.click(await screen.findByText(/Referencias \(opcional\)/));
  await attach(file('virus.exe',['x'],'application/octet-stream'));
  expect((await screen.findByRole('alert')).textContent).toMatch(/«virus.exe»: tipo no admitido/);
  await attach(file('enorme.png',[new Uint8Array(3*1024*1024+1)]));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/«enorme.png» pesa más de 3 MB/));
  await attach(...Array.from({length:6},(_,index)=>file(`p${index}.png`)));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/como mucho 5 referencias/));
  expect(screen.queryByRole('list',{name:'Referencias adjuntas'})).toBeNull();
 });

 it('says that it is analysing the references while the first call works',async()=>{
  setup({stage:'ASK_GOALS',status:'WORKING',nextAction:'WAIT',brief:'Un panel',references:[translated({status:'PENDING',translation:null})]});
  expect(await screen.findByRole('heading',{name:'Analizando tus referencias…'})).toBeTruthy();
  expect(screen.getByRole('status').textContent).toMatch(/Un modelo está describiendo en texto tus archivos/);
 });

 it('shows what the translator understood, so the user can check it, and a failed reference with its reason',async()=>{
  setup({stage:'ASK_GOALS',status:'WAITING_USER',nextAction:'ANSWER',brief:'Un panel',questions,references:[translated(),translated({id:'ref-2',name:'roto.pdf',kind:'FUNCTIONAL',note:'',status:'FAILED',error:'El archivo está vacío.',translation:null})]});
  const summary=await screen.findByText(/Cómo se entendieron tus referencias \(2\)/);
  fireEvent.click(summary);
  const details=summary.closest('details')!;
  expect(within(details).getByText(/Panel con barra lateral y tarjetas\./)).toBeTruthy();
  expect(details.textContent).toMatch(/Cómo debe verse/);
  expect(details.textContent).toMatch(/Colores:.*azul #2255ff/);
  expect(details.textContent).toMatch(/Por aclarar:.*¿Modo oscuro\?/);
  expect(details.textContent).toMatch(/No se pudo analizar: El archivo está vacío\./);
 });
});

describe('Visor del prototipo: navegación',()=>{
 it('drops the frame when the prototype navigates away or reloads itself, tells the user, and a reset brings it back',async()=>{
  const {PrototypeFrame}=await import('@desktop/presentation/inception/VisualExplorationStep.js');
  render(<PrototypeFrame html="<main>hola</main>"/>);
  const frame=screen.getByTitle('Vista previa del prototipo');
  fireEvent.load(frame);                                  // its own document loading is normal
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.load(screen.getByTitle('Vista previa del prototipo'));   // a second load: it navigated or reloaded
  expect((await screen.findByRole('alert')).textContent).toMatch(/intentó salir de su página o recargarse/);
  expect(screen.queryByTitle('Vista previa del prototipo')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reiniciar la vista previa'}));
  expect(screen.getByTitle('Vista previa del prototipo').getAttribute('srcdoc')).toContain('hola');
  expect(screen.queryByRole('alert')).toBeNull();
 });

 it('changing the prototype is not mistaken for a navigation',async()=>{
  const {PrototypeFrame}=await import('@desktop/presentation/inception/VisualExplorationStep.js');
  const view=render(<PrototypeFrame html="<main>uno</main>"/>);
  fireEvent.load(screen.getByTitle('Vista previa del prototipo'));
  view.rerender(<PrototypeFrame html="<main>dos</main>"/>);
  fireEvent.load(screen.getByTitle('Vista previa del prototipo'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTitle('Vista previa del prototipo').getAttribute('srcdoc')).toContain('dos');
 });
});

describe('Asistente de inicio: exploración visual',()=>{
 const exploring=(over:Parameters<typeof fakeInception>[0]={})=>setup({stage:'EXPLORE_UI',status:'WAITING_USER',nextAction:'CHOOSE_UI',brief:'Un panel',questions,ui:{wanted:true,options:uiOptions,selectedOptionId:null},updatedAt:new Date().toISOString(),...over});
 const iframe=()=>screen.getByTitle('Vista previa del prototipo') as HTMLIFrameElement;

 it('offers the design step with the questions, checked by default when a visual reference was attached, and sends the choice',async()=>{
  const first=setup({stage:'ASK_GOALS',status:'WAITING_USER',nextAction:'ANSWER',brief:'Un panel',questions});
  const box=await screen.findByLabelText(/Mi proyecto tiene una interfaz gráfica/) as HTMLInputElement;
  expect(box.checked).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Enviar respuestas'}));
  await waitFor(()=>expect(first.client.answer).toHaveBeenCalledWith('p',expect.any(Array)));
  expect((first.client.answer as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);
  cleanup();

  const withVisual={id:'ref-1',name:'panel.png',kind:'VISUAL' as const,note:'',mimeType:'image/png',bytes:10,status:'TRANSLATED' as const,error:null,translation:{summary:'Panel.',palette:[],typography:'',layout:'',screens:[],actions:[],flows:[],states:[],ideas:[],openQuestions:[]}};
  const second=setup({stage:'ASK_GOALS',status:'WAITING_USER',nextAction:'ANSWER',brief:'Un panel',questions,references:[withVisual]});
  expect((await screen.findByLabelText(/Mi proyecto tiene una interfaz gráfica/) as HTMLInputElement).checked).toBe(true);
  expect(within(screen.getByRole('list',{name:'Pasos del inicio'})).getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button',{name:'Enviar respuestas y diseñar'}));
  await waitFor(()=>expect(second.client.answer).toHaveBeenCalledWith('p',expect.any(Array),undefined,{exploreUi:true}));
 });

 it('shows a Diseño step and the design-specific waiting texts once the user asked for it',async()=>{
  setup({stage:'ASK_GOALS',status:'WORKING',nextAction:'WAIT',brief:'Un panel',questions,ui:{wanted:true,options:[],selectedOptionId:null},updatedAt:new Date().toISOString()});
  expect(await screen.findByRole('heading',{name:/Diseñando direcciones visuales/})).toBeTruthy();
  const steps=within(screen.getByRole('list',{name:'Pasos del inicio'})).getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  ['Objetivo y alcance','Diseño','Revisar propuesta','Listo'].forEach((label,index)=>expect(steps[index]!.textContent).toContain(label));
  expect(currentStep().textContent).toMatch(/Diseño/);
  expect(screen.getByText(/Paso 2 de 4/)).toBeTruthy();
  cleanup();
  setup({stage:'EXPLORE_UI',status:'WORKING',nextAction:'WAIT',brief:'Un panel',questions,ui:{wanted:true,options:uiOptions,selectedOptionId:null},updatedAt:new Date().toISOString()});
  expect(await screen.findByRole('heading',{name:/Ajustando el prototipo/})).toBeTruthy();
 });

 it('shows each direction with its prototype in an isolated frame: scripts yes, same origin no, and a policy with no network',async()=>{
  exploring();
  expect(await screen.findByRole('heading',{name:'Elige una dirección visual'})).toBeTruthy();
  expect(screen.getAllByRole('radio').map(radio=>(radio.closest('label') as HTMLElement).textContent)).toEqual([expect.stringContaining('Panel claro'),expect.stringContaining('Lista minimalista')]);
  await waitFor(()=>expect(screen.getByTitle('Vista previa del prototipo')).toBeTruthy());
  const frame=iframe();
  // Scripts and forms (without allow-forms a prototype's submit handlers never run); never the same origin, popups, top navigation or modals.
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  const doc=new DOMParser().parseFromString(frame.getAttribute('srcdoc')!,'text/html');
  expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
  expect(doc.head.firstElementChild?.getAttribute('content')).toMatch(/default-src 'none'.*connect-src 'none'/);
  expect(doc.querySelector('script')).not.toBeNull();
  expect(screen.getByText(/funciona sin Internet y no tiene acceso a tus datos/)).toBeTruthy();
  expect(screen.getByText('Barra lateral con tres secciones.')).toBeTruthy();
  expect(screen.getByText('Inicio · Tareas · Ajustes')).toBeTruthy();
 });

 it('switching direction loads that prototype, and warns when it tries to reach the Internet',async()=>{
  const {client}=exploring();
  await waitFor(()=>expect(client.getUiPrototype).toHaveBeenCalledWith('p','ui-1'));
  expect(screen.queryByText(/intenta usar recursos externos/)).toBeNull();
  fireEvent.click(screen.getAllByRole('radio')[1]!);
  await waitFor(()=>expect(client.getUiPrototype).toHaveBeenCalledWith('p','ui-2'));
  expect((await screen.findByRole('status')).textContent).toMatch(/recursos externos \(cdn.example.com, fetch\(\)\). No se cargarán/);
  // The frame shows the hardened version of that prototype (re-serialised), not the original string.
  await waitFor(()=>expect(iframe().getAttribute('srcdoc')).toContain('<h1>ui-2</h1>'));
 });

 it('approves the selected direction, skips the design, or asks for changes with the notes',async()=>{
  const {client}=exploring();
  await screen.findByTitle('Vista previa del prototipo');
  fireEvent.click(screen.getAllByRole('radio')[1]!);
  fireEvent.click(screen.getByRole('button',{name:'Pedir ajustes a este prototipo'}));
  const regenerate=screen.getByRole('button',{name:'Regenerar este prototipo'}) as HTMLButtonElement;
  expect(regenerate.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('¿Qué quieres cambiar de este prototipo?'),{target:{value:'  Más color  '}});
  fireEvent.click(regenerate);
  await waitFor(()=>expect(client.reviseUiOption).toHaveBeenCalledWith('p','ui-2','Más color'));
  cleanup();
  const second=exploring();
  await screen.findByTitle('Vista previa del prototipo');
  fireEvent.click(screen.getByRole('button',{name:'Aprobar esta dirección visual y preparar el plan'}));
  await waitFor(()=>expect(second.client.chooseUiOption).toHaveBeenCalledWith('p','ui-1'));
  cleanup();
  const third=exploring();
  await screen.findByTitle('Vista previa del prototipo');
  fireEvent.click(screen.getByRole('button',{name:'Saltar el diseño e ir directo al plan'}));
  await waitFor(()=>expect(third.client.chooseUiOption).toHaveBeenCalledWith('p',null));
 });

 it('imports a pasted prototype or an HTML file, refuses other files, and selects the new direction',async()=>{
  const {client}=exploring();
  await screen.findByTitle('Vista previa del prototipo');
  fireEvent.click(screen.getByText(/Importar un prototipo hecho en otra herramienta/));
  fireEvent.change(screen.getByLabelText('O pegar el HTML'),{target:{value:'<main>mi diseño</main>'}});
  fireEvent.change(screen.getByLabelText('Nombre'),{target:{value:'Mi diseño'}});
  fireEvent.click(screen.getByRole('button',{name:'Importar el HTML pegado'}));
  await waitFor(()=>expect(client.importPrototype).toHaveBeenCalledWith('p',{name:'Mi diseño',html:'<main>mi diseño</main>'}));
  await waitFor(()=>expect((screen.getAllByRole('radio').at(-1) as HTMLInputElement).checked).toBe(true));
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  const input=screen.getByLabelText('Subir un archivo .html') as HTMLInputElement;
  await act(async()=>{fireEvent.change(input,{target:{files:[new File(['x'],'foto.png',{type:'image/png'})]}});});
  expect((await screen.findByRole('alert')).textContent).toMatch(/Sube el archivo .html/);
  await act(async()=>{fireEvent.change(input,{target:{files:[new File(['<div>desde archivo</div>'],'proto.html',{type:'text/html'})]}});});
  await waitFor(()=>expect(client.importPrototype).toHaveBeenCalledWith('p',{name:'proto.html',html:'<div>desde archivo</div>'}));
 });

 it('shows why an action failed without leaving the choice, and the approved direction in the proposal',async()=>{
  exploring({error:'propuesta caída'});
  expect((await screen.findByText('propuesta caída')).closest('[role="alert"]')).not.toBeNull();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  cleanup();
  setup({stage:'PROPOSAL',status:'WAITING_USER',nextAction:'APPROVE',brief:'Un panel',questions,proposal,repositoryPath:'/home/ana/app',ui:{wanted:true,options:uiOptions,selectedOptionId:'ui-1'},updatedAt:new Date().toISOString()});
  expect((await screen.findByText(/Dirección visual aprobada:/)).closest('p')!.textContent).toMatch(/Panel claro\. La propuesta se apoya en ella/);
 });

 it('offers to retry the design when generating it failed',async()=>{
  const {client}=setup({stage:'ASK_GOALS',status:'FAILED',nextAction:'RETRY_UI',brief:'Un panel',questions,answers:[{questionId:'q1',answer:'Solo yo'}],error:'motor caído',ui:{wanted:true,options:[],selectedOptionId:null}});
  fireEvent.click(await screen.findByRole('button',{name:'Reintentar las direcciones visuales'}));
  await waitFor(()=>expect(client.answer).toHaveBeenCalledWith('p',[{questionId:'q1',answer:'Solo yo'}],undefined,{exploreUi:true}));
 });
});
