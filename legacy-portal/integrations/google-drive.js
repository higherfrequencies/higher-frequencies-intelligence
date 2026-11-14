/** Google Drive documents and backups. Integration contract only; no API connection or credentials. */
export const integration={provider:'google-drive',status:'not-configured',requiresBackend:true};
export async function connect(){throw new Error('google-drive requires an authenticated server-side integration; not available in local prototype')}
