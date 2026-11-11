const steps=[
 {title:'Planificar',text:'Describe qué quieres construir. El motor propone módulos, features y tareas sin tocar tu código.'},
 {title:'Aplicar',text:'Revisa la propuesta en el grafo (nodos fantasma) y aplica solo lo que te convenza.'},
 {title:'Ejecutar',text:'Marca tareas como listas y lánzalas con un agente; revisa y acepta el resultado.'},
];

/** Guía de arranque para un proyecto sin features. */
export function EmptyProject({projectName,onPlan}:{projectName:string;onPlan():void}) {
 return <section aria-labelledby="empty-project-title" className="rounded-xl border border-border bg-surface-raised p-6">
  <h2 id="empty-project-title" className="text-base font-semibold text-fg">{projectName} aún no tiene features</h2>
  <p className="mt-1 text-sm text-fg-muted">Tres pasos para pasar de una idea a tareas cerradas por agentes:</p>
  <ol className="mt-5 grid gap-3 md:grid-cols-3">{steps.map((step,index)=><li key={step.title} className="rounded-lg border border-border bg-surface-sunken p-4">
   <p className="flex items-center gap-2 text-sm font-semibold text-fg"><span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">{index+1}</span>{step.title}</p>
   <p className="mt-2 text-xs leading-5 text-fg-muted">{step.text}</p>
  </li>)}</ol>
  <button type="button" onClick={onPlan} className="mt-5 min-h-9 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Describir qué quiero construir</button>
 </section>;
}
