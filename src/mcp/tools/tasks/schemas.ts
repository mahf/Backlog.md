import { generateTaskListSchema, generateTaskSearchSchema } from "../../utils/schema-generators.ts";
import type { JsonSchema } from "../../validation/validators.ts";

export const taskListSchema: JsonSchema = generateTaskListSchema({});

export const taskSearchSchema: JsonSchema = generateTaskSearchSchema({});

function withWorkspaceId(schema: JsonSchema): JsonSchema {
	return {
		...schema,
		properties: {
			...schema.properties,
			workspaceId: { type: "string", description: "Registered directory workspace identity." },
		},
	};
}

export const taskViewSchema: JsonSchema = withWorkspaceId({
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
});

export const taskArchiveSchema: JsonSchema = withWorkspaceId({
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
});

/** Delete and restore take the same input as archive: the ID of one task. */
export const taskDeleteSchema: JsonSchema = taskArchiveSchema;
export const taskRestoreSchema: JsonSchema = taskArchiveSchema;

export const taskDemoteSchema: JsonSchema = withWorkspaceId({
	type: "object",
	properties: {
		id: {
			type: "string",
			minLength: 1,
			maxLength: 50,
		},
	},
	required: ["id"],
	additionalProperties: false,
});
