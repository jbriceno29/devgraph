import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { GraphNodeView } from '../../../shared/contracts/graph-view.js';
import { MAX_INCEPTION_NOTE, type InceptionIpcClient, type InceptionUsageDto, type InceptionViewDto, type InitializeRepositoryResultDto } from '../../../shared/contracts/inception-view.js';
import type { ShellTarget } from '../shell/next-step.js';
import { ErrorNotice } from '../errors.js';
import { control, primary, secondary } from '../ui.js';
import { useInception } from './use-inception.js';
import { useResetOnChange } from '../use-reset-on-change.js';
import { QuestionsStep } from './QuestionsStep.js';
import { ProposalReview, approvalBlockers, taskCount } from './ProposalReview.js';
import { RepositoryCreated, RepositorySetup } from './RepositorySetup.js';
import { ApprovedDesign } from './ApprovedDesign.js';
import { VisualExplorationStep } from './VisualExplorationStep.js';
import { ReferencesField, ReferencesSummary, type DraftReference } from './ReferencesField.js';

/** Pasado este tiempo trabajando se avisa de que sigue en marcha (no es un error). */
export const SLOW_AFTER_MS = 120_000;
const MAX_BRIEF = 4000;
/** Los pasos del inicio; «Diseño» aparece solo si el usuario pidió explorar el diseño. */
const stepsFor = (design: boolean) => (design ? ['Objetivo y alcance', 'Diseño', 'Revisar propuesta', 'Listo'] : ['Objetivo y alcance', 'Revisar propuesta', 'Listo']);
type StepKey = 'goals' | 'design' | 'proposal' | 'done';
const stepIndex = (design: boolean, key: StepKey) => ({ goals: 0, design: 1, proposal: design ? 2 : 1, done: design ? 3 : 2 })[key];
const eyebrowFor = (design: boolean, key: StepKey) => `Paso ${stepIndex(design, key) + 1} de ${stepsFor(design).length}`;
const card = 'rounded-xl border border-border bg-surface-raised p-5';
type Mode = 'view' | 'revise' | 'answers' | 'confirm';
interface Props { projectId:string; nodes:GraphNodeView[]; onNavigate(target:ShellTarget):void; onApplied?():void }

/** Asistente de inicio por pasos: brief → preguntas → propuesta → aprobación. Un único botón primario por pantalla. */
export function InceptionAssistant({projectId,nodes,onNavigate,onApplied}:Props) {
 const {client,view,loadError,actionError,setActionError,busy,reload,act}=useInception(projectId);
 const [mode,setMode]=useState<Mode>('view'),[created,setCreated]=useState<InitializeRepositoryResultDto|null>(null),[wantDesign,setWantDesign]=useState<boolean|null>(null);
 const heading=useRef<HTMLHeadingElement>(null),screenKey=view?`${view.stage}:${view.status}:${mode}`:'loading',firstScreen=useRef(true);
 // Un paso nuevo del motor vuelve a la vista normal; en el render, no en un efecto que pisaría un clic hecho justo después.
 useResetOnChange(view?`${view.stage}:${view.status}`:null,()=>setMode('view'));
 // Al cambiar de paso el foco va al título de la nueva pantalla (no en la primera carga: ahí lo pone el shell).
 useEffect(()=>{if(screenKey==='loading')return;if(firstScreen.current){firstScreen.current=false;return;}heading.current?.focus();},[screenKey]);

 if(!client)return <Wrapper><section className={card} aria-labelledby="inception-unavailable"><h2 id="inception-unavailable" className="text-base font-semibold text-fg">El asistente de inicio no está disponible</h2><p className="mt-2 text-sm text-fg-muted">Esta versión del núcleo de la app no incluye el asistente. Actualiza la app para usarlo; mientras tanto puedes describir el plan a mano en Planificar.</p><button type="button" onClick={()=>onNavigate({view:'planning'})} className={`mt-4 min-h-9 text-sm ${primary}`}>Ir a Planificar</button></section></Wrapper>;
 if(!view)return <Wrapper>{loadError?<div className="space-y-3"><ErrorNotice error={loadError}/><button type="button" onClick={()=>void reload()} className={`min-h-9 text-sm ${secondary}`}>Reintentar</button></div>:<p role="status" className="text-sm text-fg-muted">Cargando el inicio del proyecto…</p>}</Wrapper>;

 const restart=()=>{if(window.confirm('¿Empezar de nuevo? Se olvidarán las preguntas, tus respuestas y la propuesta pendiente. No se borra nada del proyecto.'))void act(ipc=>ipc.restart(projectId));};
 const restartButton=<button type="button" onClick={restart} disabled={busy} className={`min-h-9 text-sm ${secondary}`}>Empezar de nuevo</button>;
 const repository=<RepositorySetup projectId={projectId} client={client} onCreated={result=>{setCreated(result);void reload();}} onConnectExisting={()=>onNavigate({view:'documents'})}/>;
 // Con las respuestas enviadas, preparar la propuesta ya es el paso 2 aunque la etapa siga en ASK_GOALS.
 const design=view.ui.wanted,designing=view.stage==='EXPLORE_UI'||(view.stage==='ASK_GOALS'&&view.status==='WORKING'&&design&&view.questions.length>0&&!view.ui.options.length);
 const step=stepIndex(design,view.stage==='APPLIED'?'done':designing?'design':view.stage==='PROPOSAL'||(view.status==='WORKING'&&view.questions.length>0)?'proposal':'goals');
 // Por defecto se ofrece explorar el diseño cuando adjuntó una referencia visual.
 const designChecked=wantDesign??(view.ui.wanted||view.references.some(item=>item.kind==='VISUAL'));
 const hasPlan=nodes.some(node=>(node.type==='FEATURE'||node.type==='WORK_ITEM')&&node.status!=='ARCHIVED');
 let screen:ReactNode;
 if(view.status==='WORKING')screen=<Working view={view} heading={heading}/>;
 else if(view.status==='FAILED')screen=<Screen heading={heading} eyebrow="Algo falló" title="No se pudo completar el paso">
  <ErrorNotice error={view.error??'El motor no respondió. Vuelve a intentarlo.'}/>
  {view.nextAction==='SET_UP_REPOSITORY'&&!view.repositoryPath&&<div className="mt-4">{repository}</div>}
  <div className="mt-4 flex flex-wrap gap-3">
   {view.nextAction==='RETRY_QUESTIONS'&&<button type="button" disabled={busy} onClick={()=>void act(ipc=>ipc.start(projectId,{brief:view.brief,...(view.model?{model:view.model}:{})}))} className={`min-h-9 text-sm ${primary}`}>Reintentar las preguntas</button>}
   {view.nextAction==='RETRY_UI'&&<button type="button" disabled={busy} onClick={()=>void act(ipc=>ipc.answer(projectId,view.answers,undefined,{exploreUi:true}))} className={`min-h-9 text-sm ${primary}`}>Reintentar las direcciones visuales</button>}
   {view.nextAction==='RETRY_PROPOSAL'&&<button type="button" disabled={busy} onClick={()=>void act(ipc=>ipc.answer(projectId,view.answers))} className={`min-h-9 text-sm ${primary}`}>Reintentar la propuesta</button>}
   {restartButton}
  </div>
 </Screen>;
 else if(view.stage==='NOT_STARTED')screen=hasPlan
  ?<Screen heading={heading} eyebrow={eyebrowFor(false,'goals')} title="Este proyecto ya tiene un plan"><p className="text-sm text-fg-muted">El asistente de inicio es para proyectos vacíos. Para cambiar el plan, describe lo que quieres en Planificar.</p><button type="button" onClick={()=>onNavigate({view:'planning'})} className={`mt-4 min-h-9 text-sm ${primary}`}>Ir a Planificar</button></Screen>
  :<StartStep projectId={projectId} view={view} heading={heading} busy={busy} repository={repository} onStart={(brief,model,references)=>void act(ipc=>ipc.start(projectId,{brief,...(model?{model}:{}),...(references.length?{references:references.map(({key:_key,bytes:_bytes,...input})=>input)}:{})}))}/>;
 else if(view.stage==='ASK_GOALS')screen=<Screen heading={heading} eyebrow={eyebrowFor(design,'goals')} title="Unas preguntas antes de proponer" intro="Responde lo que tengas claro; en lo demás elige «Decide tú» y el asistente usará la opción recomendada.">
  <Brief text={view.brief}/>
  <ReferencesSummary references={view.references}/>
  <QuestionsStep questions={view.questions} answers={view.answers} busy={busy} submitLabel={designChecked?'Enviar respuestas y diseñar':'Enviar respuestas'} design={{checked:designChecked,onChange:setWantDesign}} onSubmit={answers=>void act(ipc=>designChecked||view.ui.wanted?ipc.answer(projectId,answers,undefined,{exploreUi:designChecked}):ipc.answer(projectId,answers))}>{restartButton}</QuestionsStep>
 </Screen>;
 else if(view.stage==='EXPLORE_UI')screen=<VisualExplorationStep client={client} projectId={projectId} view={view} heading={heading} busy={busy} eyebrow={eyebrowFor(true,'design')} onChoose={optionId=>void act(ipc=>ipc.chooseUiOption(projectId,optionId))} onRevise={(optionId,notes)=>void act(ipc=>ipc.reviseUiOption(projectId,optionId,notes))} onImport={(name,html)=>void act(ipc=>ipc.importPrototype(projectId,{name,html}))} onImportDesign={(name,kind,content)=>void act(ipc=>ipc.importDesign(projectId,{name,kind,content}))}/>;
 else if(view.stage==='PROPOSAL'&&mode==='revise')screen=<ReviseStep view={view} heading={heading} busy={busy} onSubmit={notes=>void act(ipc=>ipc.answer(projectId,view.answers,notes))} onChangeAnswers={()=>setMode('answers')} onCancel={()=>setMode('view')}/>;
 else if(view.stage==='PROPOSAL'&&mode==='answers')screen=<Screen heading={heading} eyebrow={eyebrowFor(design,'proposal')} title="Cambiar tus respuestas" intro="Cambia las respuestas que quieras. El asistente preparará una propuesta nueva y descartará la actual; los cambios que ya pediste se mantienen.">
  <QuestionsStep questions={view.questions} answers={view.answers} busy={busy} submitLabel="Generar otra propuesta" onSubmit={answers=>void act(ipc=>ipc.answer(projectId,answers))}><button type="button" onClick={()=>setMode('view')} className={`min-h-9 text-sm ${secondary}`}>Volver a la propuesta</button></QuestionsStep>
 </Screen>;
 else if(view.stage==='PROPOSAL'&&mode==='confirm'&&view.proposal)screen=<Confirm view={view} heading={heading} busy={busy} onCancel={()=>setMode('view')} onApprove={()=>void act(async ipc=>{const next=await ipc.approve(projectId);onApplied?.();return next;})}/>;
 else if(view.stage==='PROPOSAL')screen=<ProposalStep client={client} projectId={projectId} view={view} heading={heading} busy={busy} repository={repository} restartButton={restartButton} onApprove={()=>{setActionError(null);setMode('confirm');}} onRevise={()=>setMode('revise')} onReopenDesign={()=>void act(ipc=>ipc.reopenDesign(projectId))}/>;
 else screen=<Done view={view} nodes={nodes} heading={heading} onNavigate={onNavigate}/>;

 return <Wrapper>
  <Stepper current={step} steps={stepsFor(design)}/>
  {screen}
  {created&&view.stage!=='APPLIED'&&<RepositoryCreated result={created}/>}
  <ErrorNotice error={actionError}/>
  <Usage usage={view.usage} model={view.model}/>
 </Wrapper>;
}

const Wrapper=({children}:{children:ReactNode})=><div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-3xl space-y-4 pb-2 pr-1">{children}</div></div>;

function Stepper({current,steps}:{current:number;steps:string[]}) {
 return <ol aria-label="Pasos del inicio" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{steps.map((label,index)=>{const done=index<current,active=index===current;return <li key={label} aria-current={active?'step':undefined} className="flex items-center gap-2">
  {index>0&&<span aria-hidden="true" className="h-px w-6 bg-border-strong"/>}
  <span aria-hidden="true" className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${active?'bg-accent text-accent-fg':done?'bg-success-soft text-success':'bg-surface-sunken text-fg-subtle'}`}>{done?'✓':index+1}</span>
  <span className={active?'font-semibold text-fg':done?'text-fg-muted':'text-fg-subtle'}>{label}<span className="sr-only">{done?' (hecho)':active?' (paso actual)':''}</span></span>
 </li>;})}</ol>;
}

function Screen({heading,eyebrow,title,intro,children}:{heading:RefObject<HTMLHeadingElement|null>;eyebrow:string;title:string;intro?:string;children:ReactNode}) {
 const id=useId();
 return <section aria-labelledby={id} className={card}>
  <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
  <h2 id={id} ref={heading} tabIndex={-1} className="mt-1 text-base font-semibold text-fg focus:outline-none">{title}</h2>
  {intro&&<p className="mt-1 text-sm text-fg-muted">{intro}</p>}
  <div className="mt-4">{children}</div>
 </section>;
}
const Brief=({text}:{text:string})=>text?<blockquote className="mb-4 border-l-2 border-accent pl-3 text-xs leading-5 text-fg-muted"><span className="font-medium text-fg">Tu idea: </span>{text}</blockquote>:null;

function StartStep({projectId,view,heading,busy,repository,onStart}:{projectId:string;view:InceptionViewDto;heading:RefObject<HTMLHeadingElement|null>;busy:boolean;repository:ReactNode;onStart(brief:string,model:string,references:DraftReference[]):void}) {
 const id=useId();
 const [brief,setBrief]=useState(view.brief),[error,setError]=useState<string|null>(null),[references,setReferences]=useState<DraftReference[]>([]);
 const [models,setModels]=useState<{list:string[];recommended:string|null}>({list:[],recommended:null}),[model,setModel]=useState('');
 useEffect(()=>{let live=true;void window.workspaceIpc.queries.listAgentProfiles(projectId).then(profiles=>{const profile=profiles.find(item=>item.roleKey==='DEVELOPER')??profiles[0];if(!live||!profile)return;setModels({list:profile.availableModels??[],recommended:profile.planningModel??null});setModel(profile.planningModel??profile.availableModels?.[0]??'');}).catch(()=>undefined);return ()=>{live=false;};},[projectId]);
 return <Screen heading={heading} eyebrow={eyebrowFor(false,'goals')} title="Cuéntanos tu idea">
  <div className="space-y-1 text-sm text-fg-muted">
   <p>El asistente te hará hasta 5 preguntas sobre objetivo y alcance.</p>
   <p>Después propondrá la visión, el stack, las reglas y un plan inicial con sus tareas. Nada se crea hasta que lo apruebes.</p>
   <p>Tarda unos minutos en total, casi todo esperando al motor.</p>
  </div>
  <form noValidate className="mt-5 space-y-4" onSubmit={event=>{event.preventDefault();if(!brief.trim()){setError('Describe en pocas líneas qué quieres construir.');return;}onStart(brief.trim(),model,references);}}>
   <div>
    <label htmlFor={`${id}-brief`} className="mb-1 block text-sm font-medium text-fg">¿Qué quieres construir?</label>
    <textarea id={`${id}-brief`} rows={5} maxLength={MAX_BRIEF} value={brief} onChange={event=>{setBrief(event.target.value);setError(null);}} aria-invalid={error?true:undefined} aria-describedby={`${id}-brief-help${error?` ${id}-brief-error`:''}`} placeholder="Por ejemplo: una lista de tareas para la terminal, para uso personal, sin dependencias externas." className={`${control} py-2 text-sm leading-6 ${error?'border-danger':''}`}/>
    <p id={`${id}-brief-help`} className="mt-1 text-[11px] text-fg-subtle">Unas líneas bastan: para quién es, qué problema resuelve y cualquier preferencia (lenguaje, plataforma…). {brief.length}/{MAX_BRIEF}</p>
    {error&&<p id={`${id}-brief-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
   </div>
   <ReferencesField value={references} onChange={setReferences} disabled={busy}/>
   {models.list.length>0&&<div>
    <label htmlFor={`${id}-model`} className="mb-1 block text-xs font-medium text-fg">Modelo</label>
    <select id={`${id}-model`} value={model} onChange={event=>setModel(event.target.value)} aria-describedby={`${id}-model-help`} className={`${control} max-w-xs`}>{models.list.map(option=><option key={option} value={option}>{option}{option===models.recommended?' (recomendado)':''}</option>)}</select>
    <p id={`${id}-model-help`} className="mt-1 text-[11px] text-fg-subtle">Cuesta unos centavos de dólar con modelos económicos; más con opus.</p>
   </div>}
   <button type="submit" disabled={busy} className={`min-h-9 text-sm ${primary}`}>Empezar</button>
  </form>
  <div className="mt-6 border-t border-border pt-4">{view.repositoryPath
   ?<p className="text-xs text-fg-muted">Repositorio del proyecto: <code className="font-mono text-fg">{view.repositoryPath}</code></p>
   :<details><summary className="min-h-9 cursor-pointer py-2 text-sm font-medium text-accent">Crear un repositorio nuevo (opcional)</summary><p className="mb-3 text-xs text-fg-muted">Lo necesitarás para aprobar la propuesta, pero puedes crearlo ahora o más tarde.</p>{repository}</details>}</div>
 </Screen>;
}

function Working({view,heading}:{view:InceptionViewDto;heading:RefObject<HTMLHeadingElement|null>}) {
 const adjusting=view.stage==='EXPLORE_UI',designing=!adjusting&&view.ui.wanted&&view.stage==='ASK_GOALS'&&view.questions.length>0&&!view.ui.options.length,proposing=!adjusting&&!designing&&view.questions.length>0;
 const [since]=useState(()=>{const at=Date.parse(view.updatedAt??''),now=Date.now();return Number.isNaN(at)||at>now||now-at>3_600_000?now:at;});
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
 const elapsed=Math.max(0,now-since),slow=elapsed>=SLOW_AFTER_MS,seconds=Math.floor(elapsed/1000);
 const analysing=!proposing&&view.references.some(item=>item.status!=='TRANSLATED');
 const title=adjusting?'Trabajando en tu diseño, puede tardar un par de minutos':designing?'Diseñando direcciones visuales, puede tardar unos minutos':proposing?'Preparando la propuesta, puede tardar un minuto':analysing?'Analizando tus referencias…':'Pensando el objetivo…';
 return <Screen heading={heading} eyebrow={eyebrowFor(view.ui.wanted,adjusting||designing?'design':proposing?'proposal':'goals')} title={title}>
  <div role="status" aria-live="polite" className="space-y-2 text-sm text-fg-muted">
   <p>{adjusting?'El asistente está trabajando en lo que pediste (un ajuste, o describir o convertir lo que importaste); las demás direcciones se quedan como están.':designing?'El asistente está diseñando 2 o 3 direcciones distintas, cada una con un prototipo que podrás probar.':proposing?'El asistente está escribiendo la visión, el stack, las reglas y el plan inicial a partir de tus respuestas.':analysing?'Un modelo está describiendo en texto tus archivos; después el asistente leerá esa descripción junto con tu idea y preparará unas pocas preguntas.':'El asistente está leyendo tu idea y preparando unas pocas preguntas.'}</p>
   {slow&&<p className="font-medium text-fg">Sigue trabajando. Algunas respuestas tardan más; no hace falta que esperes aquí.</p>}
  </div>
  <div aria-hidden="true" className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full w-full animate-pulse rounded-full bg-accent/60 motion-reduce:animate-none"/></div>
  <p className="mt-2 text-[11px] text-fg-subtle">Lleva {seconds<60?`${seconds} s`:`${Math.floor(seconds/60)} min`}. Puedes ir a otras vistas: te avisaremos en Actividad cuando termine.</p>
 </Screen>;
}

function ProposalStep({client,projectId,view,heading,busy,repository,restartButton,onApprove,onRevise,onReopenDesign}:{client:InceptionIpcClient;projectId:string;view:InceptionViewDto;heading:RefObject<HTMLHeadingElement|null>;busy:boolean;repository:ReactNode;restartButton:ReactNode;onApprove():void;onRevise():void;onReopenDesign():void}) {
 const id=useId(),blockers=approvalBlockers(view),canApprove=view.nextAction==='APPROVE'&&!blockers.length;
 return <Screen heading={heading} eyebrow={eyebrowFor(view.ui.wanted,'proposal')} title={view.proposal?.title||'Revisa la propuesta'} intro="Léela con calma: al aprobarla se crean los documentos, la decisión de stack, las reglas y el plan.">
  <ReferencesSummary references={view.references}/>
  {view.ui.selectedOptionId&&<ApprovedDesign view={view} client={client} projectId={projectId}/>}
  <ProposalReview view={view}/>
  {!view.repositoryPath&&<div className="mt-4 rounded-lg border border-border bg-surface-sunken p-4"><h3 className="mb-2 text-sm font-semibold text-fg">Crear un repositorio nuevo</h3>{repository}</div>}
  {!canApprove&&blockers.length>0&&<ul id={`${id}-blockers`} className="mt-4 list-disc space-y-0.5 pl-5 text-xs text-fg-muted">{blockers.map(item=><li key={item}>{item}</li>)}</ul>}
  <div className="mt-4 flex flex-wrap gap-3">
   <button type="button" disabled={busy||!canApprove} aria-describedby={canApprove?undefined:`${id}-blockers`} onClick={onApprove} className={`min-h-9 text-sm ${primary}`}>Aprobar y crear el plan</button>
   <button type="button" disabled={busy} onClick={onRevise} className={`min-h-9 text-sm ${secondary}`}>Pedir otra propuesta</button>
   <button type="button" disabled={busy} onClick={onReopenDesign} className={`min-h-9 text-sm ${secondary}`}>{view.ui.options.length?'Volver a las direcciones de diseño':'Ver propuestas de diseño'}</button>
   {restartButton}
  </div>
 </Screen>;
}

/** «Pedir otra propuesta»: qué cambiar en texto libre; mantiene las respuestas (cambiarlas es opcional). */
function ReviseStep({view,heading,busy,onSubmit,onChangeAnswers,onCancel}:{view:InceptionViewDto;heading:RefObject<HTMLHeadingElement|null>;busy:boolean;onSubmit(notes:string):void;onChangeAnswers():void;onCancel():void}) {
 const id=useId(),[notes,setNotes]=useState('');
 return <Screen heading={heading} eyebrow={eyebrowFor(view.ui.wanted,'proposal')} title="Pedir otra propuesta" intro="Cuéntale al asistente qué no te convence. Preparará una propuesta nueva con tus mismas respuestas y descartará la actual.">
  {view.notes.length>0&&<div className="mb-4 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-fg-muted"><p className="font-medium text-fg">Ya pediste (se sigue teniendo en cuenta)</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{view.notes.map((note,index)=><li key={index} className="whitespace-pre-wrap break-words">{note}</li>)}</ul></div>}
  <form noValidate className="space-y-4" onSubmit={event=>{event.preventDefault();onSubmit(notes.trim());}}>
   <div>
    <label htmlFor={`${id}-notes`} className="mb-1 block text-sm font-medium text-fg">¿Qué quieres cambiar?</label>
    <textarea id={`${id}-notes`} rows={4} maxLength={MAX_INCEPTION_NOTE} value={notes} onChange={event=>setNotes(event.target.value)} aria-describedby={`${id}-notes-help`} placeholder="Por ejemplo: usa Python en lugar de Node, o deja las etiquetas para más adelante." className={`${control} py-2 text-sm leading-6`}/>
    <p id={`${id}-notes-help`} className="mt-1 text-[11px] text-fg-subtle">Si lo dejas vacío, lo intentará de nuevo con lo mismo. {notes.length}/{MAX_INCEPTION_NOTE}</p>
   </div>
   <div className="flex flex-wrap gap-3">
    <button type="submit" disabled={busy} className={`min-h-9 text-sm ${primary}`}>Generar otra propuesta</button>
    <button type="button" onClick={onChangeAnswers} disabled={busy} className={`min-h-9 text-sm ${secondary}`}>Cambiar mis respuestas</button>
    <button type="button" onClick={onCancel} disabled={busy} className={`min-h-9 text-sm ${secondary}`}>Volver a la propuesta</button>
   </div>
  </form>
 </Screen>;
}

function Confirm({view,heading,busy,onApprove,onCancel}:{view:InceptionViewDto;heading:RefObject<HTMLHeadingElement|null>;busy:boolean;onApprove():void;onCancel():void}) {
 const proposal=view.proposal!,profile=proposal.profile;
 const items=[
  profile&&`El perfil del proyecto: ${profile.objectives.length} objetivos, el stack y ${profile.rules.length} reglas.`,
  proposal.decision&&`La decisión «${proposal.decision.title}».`,
  proposal.documents.length&&`${proposal.documents.length} documentos en el repositorio: ${proposal.documents.map(document=>document.relativePath).join(', ')}.`,
  proposal.requirements.length&&`${proposal.requirements.length} requisitos.`,
  `${proposal.features.length} features y ${taskCount(proposal)} tareas.`,
  proposal.scaffoldTaskTitle&&`La primera tarea, «${proposal.scaffoldTaskTitle}», quedará lista para ejecutarse.`,
 ].filter((item):item is string=>typeof item==='string');
 return <Screen heading={heading} eyebrow={eyebrowFor(view.ui.wanted,'proposal')} title="¿Crear el plan?" intro="Al aprobar se creará:">
  <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{items.map(item=><li key={item}>{item}</li>)}</ul>
  <p className="mt-3 text-xs text-fg-subtle">No se ejecuta ningún agente todavía. Después podrás cambiar el plan desde Planificar.</p>
  <div className="mt-4 flex flex-wrap gap-3">
   <button type="button" disabled={busy} onClick={onApprove} className={`min-h-9 text-sm ${primary}`}>{busy?'Creando el plan…':'Sí, crear el plan'}</button>
   <button type="button" disabled={busy} onClick={onCancel} className={`min-h-9 text-sm ${secondary}`}>Volver a la propuesta</button>
  </div>
 </Screen>;
}

function Done({view,nodes,heading,onNavigate}:{view:InceptionViewDto;nodes:GraphNodeView[];heading:RefObject<HTMLHeadingElement|null>;onNavigate(target:ShellTarget):void}) {
 const proposal=view.proposal,first=proposal?.scaffoldTaskTitle??null;
 // El id llega del núcleo al aplicar la propuesta; el título queda como respaldo (núcleos anteriores).
 const taskId=view.scaffoldTaskId??(first?nodes.find(node=>node.type==='WORK_ITEM'&&node.label===first&&node.status!=='ARCHIVED')?.id:undefined);
 return <>
  <Screen heading={heading} eyebrow={eyebrowFor(view.ui.wanted,'done')} title="Proyecto listo">
   {proposal?.profile?.description&&<p className="text-sm text-fg">{proposal.profile.description}</p>}
   {proposal&&<p className="mt-2 text-sm text-fg-muted">Se crearon {proposal.features.length} features y {taskCount(proposal)} tareas{proposal.decision?`, la decisión «${proposal.decision.title}»`:''}{proposal.documents.length?` y ${proposal.documents.length} documentos`:''}.</p>}
   <div className="mt-4 rounded-lg border border-success/50 bg-success-soft px-4 py-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-success">Qué sigue</p>
    <p className="mt-0.5 text-sm font-medium text-fg">{first?`Ejecuta la primera tarea: ${first}`:'Ejecuta la primera tarea del plan'}</p>
    <p className="mt-0.5 text-xs text-fg-muted">Un agente la hace en su propia rama; tú revisas el resultado antes de aceptarlo.</p>
   </div>
   <div className="mt-4 flex flex-wrap gap-3">
    {taskId?<><button type="button" onClick={()=>onNavigate({view:'agents',workItemId:taskId})} className={`min-h-9 text-sm ${primary}`}>Ir a la primera tarea</button><button type="button" onClick={()=>onNavigate({view:'graph'})} className={`min-h-9 text-sm ${secondary}`}>Ver el plan en el grafo</button></>
     :<button type="button" onClick={()=>onNavigate({view:'graph'})} className={`min-h-9 text-sm ${primary}`}>Ver el plan en el grafo</button>}
   </div>
  </Screen>
  {proposal&&<section aria-labelledby="inception-decided" className={card}><h2 id="inception-decided" className="mb-4 text-base font-semibold text-fg">Lo que se decidió</h2><ProposalReview view={view} applied/></section>}
 </>;
}

/** «2 llamadas al motor · unos US$ 0,04 · sonnet». */
export function usageText(usage:InceptionUsageDto,model:string|null):string|null {
 if(!usage.calls)return null;
 const cost=usage.costUsd===null?'costo no disponible':usage.costUsd<0.01?'menos de un centavo de dólar':`unos US$ ${usage.costUsd.toLocaleString('es',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 return [`${usage.calls} ${usage.calls===1?'llamada':'llamadas'} al motor`,`costo estimado: ${cost}`,model].filter(Boolean).join(' · ');
}
const Usage=({usage,model}:{usage:InceptionUsageDto;model:string|null})=>{const text=usageText(usage,model);return text?<p className="text-right text-[11px] text-fg-subtle">{text}</p>:null;};
