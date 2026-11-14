/** Airtable structured database. Integration contract only; no API connection or credentials. */
export const integration={provider:'airtable',status:'not-configured',requiresBackend:true};
export async function connect(){throw new Error('airtable requires an authenticated server-side integration; not available in local prototype')}
