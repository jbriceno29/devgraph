import { useId, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { InceptionFeatureDto, InceptionProposalDto, InceptionViewDto } from '../../../shared/contracts/inception-view.js';
import { changeSetStatusLabel } from '../labels.js';

const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;
const joinNames=(names:string[])=>names.length<2?names.join(''):`${names.slice(0,-1).join(', ')} y ${names.at(-1)}`;

/** «Empieza cuando termine Fundación» a partir de los tempId de DEPENDS_ON. */
export function dependencyText(feature:InceptionFeatureDto,features:InceptionFeatureDto[]):string {
 const names=feature.dependsOn.map(id=>features.find(item=>item.tempId===id)?.title??id);
 if(names.length)return `Empieza cuando ${names.length===1?'termine':'terminen'} ${joinNames(names)}`;
 return feature.isFoundation?'Va primero: prepara la base del proyecto':'Puede empezar en cualquier momento';
}
/** Fundación primero y, dentro de ella, la tarea de preparación. */
export function orderedPlan(proposal:InceptionProposalDto):InceptionFeatureDto[] {
 return [...proposal.features].sort((a,b)=>Number(b.isFoundation)-Number(a.isFoundation)).map(feature=>({...feature,tasks:[...feature.tasks].sort((a,b)=>Number(b.title===proposal.scaffoldTaskTitle)-Number(a.title===proposal.scaffoldTaskTitle))}));
}
export const taskCount=(proposal:InceptionProposalDto)=>proposal.features.reduce((total,feature)=>total+feature.tasks.length,0);
/** Qué falta para poder aprobar, en lenguaje llano (vacío: se puede aprobar). */
export function approvalBlockers(view:InceptionViewDto):string[] {
 const proposal=view.proposal,out:string[]=[];
 if(!proposal)return ['La propuesta ya no está disponible. Pide otra propuesta.'];
 if(proposal.issues.length||view.error)out.push('La propuesta tiene problemas (mira los avisos). Pide otra propuesta.');
 else if(proposal.status!=='VALIDATED')out.push(`La propuesta no pasó la validación (${changeSetStatusLabel(proposal.status).toLowerCase()}). Pide otra propuesta.`);
 if(!view.repositoryPath)out.push('Falta el repositorio Git: la visión y la decisión se guardan en su carpeta docs/. Créalo o conéctalo abajo.');
 return out;
}

function Section({title,children,empty}:{title:string;children:ReactNode;empty?:boolean}) {
 const id=useId();
 return <section aria-labelledby={id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
  <h3 id={id} className="text-sm font-semibold text-fg">{title}</h3>
  <div className="mt-2 text-xs leading-5 text-fg-muted">{empty?<p className="text-fg-subtle">Sin datos en la propuesta.</p>:children}</div>
 </section>;
}
const List=({items,mono=false}:{items:string[];mono?:boolean})=><ul className="list-disc space-y-1 pl-5">{items.map(item=><li key={item} className={mono?'font-mono text-fg':''}>{item}</li>)}</ul>;
const Markdown=({text}:{text:string})=><div className="markdown-preview text-xs [&_p]:my-1.5"><ReactMarkdown>{text}</ReactMarkdown></div>;

/** Revisión legible de la propuesta de inicio (también sirve, ya aplicada, para consultar lo decidido). */
export function ProposalReview({view,applied=false}:{view:InceptionViewDto;applied?:boolean}) {
 const proposal=view.proposal;
 if(!proposal)return null;
 const profile=proposal.profile,decision=proposal.decision,plan=orderedPlan(proposal),stack=Object.entries(profile?.techStack??{});
 const issues=[...proposal.issues,...(!applied&&view.error?[view.error]:[])];
 return <div className="space-y-4">
  {!applied&&issues.length>0&&<div role="alert" className="rounded-lg border border-warning/50 bg-warning-soft px-3 py-2 text-xs text-fg"><p className="font-semibold">Avisos de la propuesta</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
  {view.notes?.length>0&&<div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-fg"><p className="font-semibold">{applied?'Cambios que pediste':'Esta propuesta tiene en cuenta lo que pediste'}</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-muted">{view.notes.map((note,index)=><li key={index} className="whitespace-pre-wrap break-words">{note}</li>)}</ul></div>}
  {!applied&&proposal.decisionReasons.length>0&&<div className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-fg"><p className="font-semibold">Por qué necesita tu aprobación</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{proposal.decisionReasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}
  <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
   <Section title="Resumen del proyecto" empty={!profile&&!proposal.rationale}>
    {profile?.description&&<p className="text-sm text-fg">{profile.description}</p>}
    {!!profile?.objectives.length&&<><p className="mt-3 font-medium text-fg">Objetivos</p><List items={profile.objectives}/></>}
    {!!profile?.outOfScope.length&&<><p className="mt-3 font-medium text-fg">Fuera de alcance</p><List items={profile.outOfScope}/></>}
    {view.assumptions.length>0&&<><p className="mt-3 font-medium text-fg">Lo que el asistente supuso</p><List items={view.assumptions}/></>}
   </Section>
   <Section title="Stack elegido" empty={!stack.length&&!decision}>
    {profile?.stackProfile&&<div className="mb-3 rounded-lg border border-border bg-surface-raised px-3 py-2"><p className="text-fg"><span className="font-medium">Perfil recomendado: {profile.stackProfile.title}</span> <span className="text-[11px] text-fg-subtle">(catálogo revisado el {profile.stackProfile.reviewedAt})</span></p><p className="mt-1 text-fg-muted">{profile.stackProfile.packages.length?<>La app instalará estos paquetes en cada ejecución: <span className="font-mono text-[11px]">{profile.stackProfile.packages.join(', ')}</span>.</>:'Sin dependencias externas: solo la biblioteca estándar.'}</p></div>}
    {stack.length>0&&<dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1">{stack.map(([key,value])=><div key={key} className="contents"><dt className="text-fg-subtle">{key}</dt><dd className="text-fg">{value}</dd></div>)}</dl>}
    {decision&&<div className="mt-3 space-y-2">
     <p className="font-medium text-fg">Decisión: {decision.title}</p>
     {decision.decisionMd&&<Markdown text={decision.decisionMd}/>}
     {decision.alternativesMd&&<details className="rounded-lg border border-border px-3 py-1"><summary className="min-h-9 cursor-pointer py-2 font-medium text-accent">Alternativas consideradas</summary><Markdown text={decision.alternativesMd}/></details>}
     {decision.consequencesMd&&<details className="rounded-lg border border-border px-3 py-1"><summary className="min-h-9 cursor-pointer py-2 font-medium text-accent">Consecuencias</summary><Markdown text={decision.consequencesMd}/></details>}
    </div>}
   </Section>
   <Section title="Reglas del proyecto" empty={!profile?.rules.length}><p className="mb-1">Los agentes las leerán antes de cada tarea.</p><List items={profile?.rules??[]}/></Section>
   <Section title="Cómo se verificará" empty={!profile?.verificationCommands.length}><p className="mb-1">Comandos que se ejecutan para comprobar cada tarea:</p><List mono items={profile?.verificationCommands??[]}/></Section>
   <Section title={applied?'Documentos creados':'Documentos que se crearán'} empty={!proposal.documents.length}><ul className="space-y-1">{proposal.documents.map(document=><li key={document.relativePath}><span className="text-fg">{document.title}</span> <code className="font-mono text-[11px] text-fg-subtle">{document.relativePath}</code></li>)}</ul></Section>
   <Section title="Requisitos" empty={!proposal.requirements.length}><List items={proposal.requirements}/></Section>
   <Section title="Plan" empty={!plan.length}>
    <p className="mb-2">{plural(plan.length,'feature','features')} con {plural(taskCount(proposal),'tarea','tareas')}.</p>
    <ol className="space-y-3">{plan.map(feature=><li key={feature.tempId} className="rounded-lg border border-border bg-surface-raised p-3">
     <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">{feature.title}{feature.isFoundation&&!/fundaci[oó]n/i.test(feature.title)&&<span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">Fundación</span>}</p>
     <p className="text-[11px] text-fg-subtle">{dependencyText(feature,plan)}</p>
     <ol className="mt-2 space-y-1 border-l border-border pl-3">{feature.tasks.map(task=>{const first=task.title===proposal.scaffoldTaskTitle;return <li key={task.tempId} className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-fg">{task.title}</span>
      {first&&<span className="rounded bg-success-soft px-1.5 text-[11px] font-medium text-success">Primera tarea</span>}
      <span className="text-[11px] text-fg-subtle">{task.initialStatus==='READY'?'lista para empezar':'espera a las anteriores'}</span>
     </li>;})}</ol>
    </li>)}</ol>
   </Section>
  </div>
 </div>;
}
