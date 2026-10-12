import type { UpdateWorkTrackerModulePresentationMutation } from "./generated/projects.documents";

/** Generated module presentation fields, without the transport discriminator. */
export type ModulePresentation = Omit<UpdateWorkTrackerModulePresentationMutation["update_module_presentation"], "__typename">;
