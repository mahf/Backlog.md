import type { GitOperations } from "../git/operations.ts";

export function installBatchTaskGitFixture(git: GitOperations): GitOperations {
	const objectIds = new Map<string, string>();
	const filesByObjectId = new Map<string, { ref: string; path: string }>();
	let nextObjectId = 0;
	git.listFilesWithObjectIdsInTree = async (ref, path) => {
		const files = await git.listFilesInTree(ref, path);
		return files.map((filePath) => {
			const key = `${ref}\0${filePath}`;
			let objectId = objectIds.get(key);
			if (!objectId) {
				objectId = `fixture-${++nextObjectId}`;
				objectIds.set(key, objectId);
				filesByObjectId.set(objectId, { ref, path: filePath });
			}
			return { path: filePath, objectId };
		});
	};
	git.showBlobs = async (requestedObjectIds) =>
		await Promise.all(
			requestedObjectIds.map(async (objectId) => {
				const file = filesByObjectId.get(objectId);
				return file ? await git.showFile(file.ref, file.path) : null;
			}),
		);
	return git;
}
