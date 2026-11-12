import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { InceptionAnswerDto, InceptionQuestionDto } from '../../../shared/contracts/inception-view.js';
import { control, primary } from '../ui.js';

type Choice = { kind:'option'|'decide'|'other'; text:string };
const initialChoice=(question:InceptionQuestionDto,answers:InceptionAnswerDto[]):Choice=>{
 const answer=answers.find(item=>item.questionId===question.id)?.answer.trim()??'';
 return !answer?{kind:'decide',text:''}:question.options.includes(answer)?{kind:'option',text:answer}:{kind:'other',text:answer};
};
/** Respuesta que se envía: la opción, el texto libre o '' («decide tú»). */
const toAnswer=(choice:Choice)=>choice.kind==='decide'?'':choice.text.trim();
const card=(checked:boolean)=>`flex min-h-9 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${checked?'border-accent bg-accent-soft text-fg':'border-border bg-surface-sunken text-fg-muted hover:border-border-strong hover:text-fg'}`;

/** Preguntas de objetivo y alcance: opciones tipo radio (la sugerida marcada «Recomendada»), «Decide tú» y una respuesta libre. */
export function QuestionsStep({questions,answers,busy,submitLabel,onSubmit,design,children}:{questions:InceptionQuestionDto[];answers:InceptionAnswerDto[];busy:boolean;submitLabel:string;onSubmit(answers:InceptionAnswerDto[]):void;/** Opción de ver propuestas de diseño antes del plan (solo al responder las primeras preguntas). */design?:{checked:boolean;onChange(next:boolean):void};children?:ReactNode}) {
 const id=useId();
 const [choices,setChoices]=useState<Record<string,Choice>>(()=>Object.fromEntries(questions.map(question=>[question.id,initialChoice(question,answers)])));
 const [invalid,setInvalid]=useState<string[]>([]);
 const inputs=useRef<Record<string,HTMLInputElement|null>>({});
 const choose=(questionId:string,choice:Choice)=>{setChoices(current=>({...current,[questionId]:choice}));setInvalid(current=>current.filter(item=>item!==questionId));};
 const submit=(event:FormEvent)=>{
  event.preventDefault();
  const empty=questions.filter(question=>choices[question.id]?.kind==='other'&&!choices[question.id]!.text.trim()).map(question=>question.id);
  setInvalid(empty);
  if(empty.length){inputs.current[empty[0]!]?.focus();return;}
  onSubmit(questions.map(question=>({questionId:question.id,answer:toAnswer(choices[question.id]??{kind:'decide',text:''})})));
 };
 return <form onSubmit={submit} noValidate className="space-y-4">
  <ol className="space-y-4">{questions.map((question,index)=>{
   const choice=choices[question.id]??{kind:'decide',text:''},name=`${id}-${question.id}`,error=invalid.includes(question.id);
   return <li key={question.id} className="rounded-lg border border-border bg-surface p-4">
    <fieldset aria-describedby={question.why?`${name}-why`:undefined}>
     <legend className="text-sm font-medium text-fg">{index+1}. {question.text}</legend>
     {question.why&&<p id={`${name}-why`} className="mt-1 text-[11px] leading-4 text-fg-subtle">Por qué lo pregunta: {question.why}</p>}
     <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {question.options.map(option=>{const checked=choice.kind==='option'&&choice.text===option;return <label key={option} className={card(checked)}>
       <input type="radio" name={name} checked={checked} onChange={()=>choose(question.id,{kind:'option',text:option})} className="mt-0.5 accent-[var(--accent)]"/>
       <span className="flex-1">{option}{option===question.default&&<span className="ml-2 inline-block rounded bg-success-soft px-1.5 text-[11px] font-medium text-success">Recomendada</span>}</span>
      </label>;})}
      <label className={card(choice.kind==='decide')}>
       <input type="radio" name={name} checked={choice.kind==='decide'} onChange={()=>choose(question.id,{kind:'decide',text:''})} className="mt-0.5 accent-[var(--accent)]"/>
       <span className="flex-1"><span className="font-medium">Decide tú</span><span className="block text-[11px] text-fg-subtle">{question.default?`Usará la recomendada: «${question.default}».`:'El asistente elegirá la opción más sencilla.'}</span></span>
      </label>
      <label className={`${card(choice.kind==='other')} sm:col-span-2`}>
       <input type="radio" name={name} checked={choice.kind==='other'} onChange={()=>{choose(question.id,{kind:'other',text:choice.kind==='other'?choice.text:''});requestAnimationFrame(()=>inputs.current[question.id]?.focus());}} className="mt-0.5 accent-[var(--accent)]"/>
       <span className="font-medium">Otra respuesta</span>
      </label>
     </div>
     {choice.kind==='other'&&<div className="mt-2">
      <input ref={element=>{inputs.current[question.id]=element;}} aria-label={`Tu respuesta a la pregunta ${index+1}`} value={choice.text} maxLength={1000} onChange={event=>choose(question.id,{kind:'other',text:event.target.value})} aria-invalid={error?true:undefined} aria-describedby={error?`${name}-error`:undefined} placeholder="Escribe tu respuesta" className={`${control} ${error?'border-danger':''}`}/>
      {error&&<p id={`${name}-error`} role="alert" className="mt-1 text-xs text-danger">Escribe tu respuesta o elige otra opción.</p>}
     </div>}
    </fieldset>
   </li>;})}</ol>
  {design&&<div className="rounded-lg border border-border bg-surface p-4"><label className="flex cursor-pointer items-start gap-2 text-sm text-fg"><input type="checkbox" checked={design.checked} onChange={event=>design.onChange(event.target.checked)} className="mt-0.5 accent-[var(--accent)]"/><span><span className="font-medium">Mi proyecto tiene una interfaz gráfica: quiero ver propuestas de diseño antes del plan</span><span className="mt-1 block text-xs leading-5 text-fg-muted">Un modelo diseña 2 o 3 direcciones con un prototipo completo que puedes probar, ajustar o reemplazar por uno tuyo. Tarda de 5 a 7 minutos y cuesta entre medio dólar y un dólar. Si es un programa de terminal, una librería o un servicio, déjalo sin marcar.</span></span></label></div>}
  <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={busy} className={`min-h-9 text-sm ${primary}`}>{submitLabel}</button>{children}</div>
 </form>;
}
