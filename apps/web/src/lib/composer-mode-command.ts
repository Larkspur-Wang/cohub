const CREATE_MODE_COMMAND = ":create";

export function isCreateModeCommand(value: string): boolean {
	return value.trim() === CREATE_MODE_COMMAND;
}
