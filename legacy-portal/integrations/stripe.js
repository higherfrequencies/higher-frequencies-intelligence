/** Stripe commercial payment reconciliation. Integration contract only; no API connection or credentials. */
export const integration={provider:'stripe',status:'not-configured',requiresBackend:true};
export async function connect(){throw new Error('stripe requires an authenticated server-side integration; not available in local prototype')}
