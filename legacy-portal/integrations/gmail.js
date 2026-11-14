/** Gmail approved draft workflows. Integration contract only; no API connection or credentials. */
export const integration={provider:'gmail',status:'not-configured',requiresBackend:true};
export async function connect(){throw new Error('gmail requires an authenticated server-side integration; not available in local prototype')}
