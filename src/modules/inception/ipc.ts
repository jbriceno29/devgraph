import type { InceptionAnswerDto, StartInceptionInput } from '../../shared/contracts/inception-view.js';
import { serial, text, type IpcHandlers } from '../../shared/ipc-handlers.js';
import type { ProjectInceptionService } from './application/project-inception-service.js';

export interface InceptionIpcDeps {
  inception(projectId: string): ProjectInceptionService;
}

/** The project inception assistant: questions, design directions, proposal and approval. */
export function inceptionHandlers(d: InceptionIpcDeps): IpcHandlers {
  const of = (projectId: unknown) => d.inception(text(projectId));
  return {
    'inception:get': ([id]) => of(id).get(text(id)),
    'inception:start': serial(([id, input]) => of(id).start(text(id), (input ?? {}) as StartInceptionInput)),
    'inception:answer': serial(([id, answers, notes, raw]) => {
      const options = raw as { exploreUi?: boolean; corrections?: unknown; access?: unknown } | undefined;
      return of(id).answer(
        text(id),
        (Array.isArray(answers) ? answers : []) as InceptionAnswerDto[],
        typeof notes === 'string' ? notes : undefined,
        options && typeof options === 'object'
          ? {
              ...(options.exploreUi !== undefined ? { exploreUi: options.exploreUi === true } : {}),
              ...(options.corrections !== undefined ? { corrections: options.corrections } : {}),
              ...('access' in options ? { access: options.access } : {}),
            }
          : undefined,
      );
    }),
    'inception:import_prototype': serial(([id, input]) =>
      of(id).importPrototype(text(id), (input ?? {}) as { name: string; html: string }),
    ),
    'inception:import_design': serial(([id, input]) =>
      of(id).importDesign(text(id), (input ?? {}) as { name: string; kind: 'IMAGE' | 'REACT'; content: string }),
    ),
    'inception:revise_ui': serial(([id, optionId, notes]) =>
      of(id).reviseUiOption(text(id), text(optionId), text(notes)),
    ),
    'inception:choose_ui': serial(([id, optionId]) =>
      of(id).chooseUiOption(text(id), typeof optionId === 'string' ? optionId : null),
    ),
    'inception:reopen_design': serial(([id]) => of(id).reopenDesign(text(id))),
    'inception:get_ui_prototype': ([id, optionId]) => of(id).getUiPrototype(text(id), text(optionId)),
    'inception:approve': serial(([id]) => of(id).approve(text(id))),
    'inception:restart': serial(([id]) => of(id).restart(text(id))),
  };
}
