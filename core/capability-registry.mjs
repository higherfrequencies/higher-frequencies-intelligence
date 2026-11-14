import {HubRegistry} from './hub-registry.mjs';
/** Single-source registry facade: capability discovery is derived from hub manifests. */
export class CapabilityRegistry extends HubRegistry {
 discover(capability,{sector,department}={}){return this.list().filter(h=>h.enabled&&h.capabilities.includes(capability)&&(!sector||h.sector===sector)&&(!department||h.department===department)).map(h=>({id:h.id,version:h.version,sector:h.sector??null,department:h.department??null,capability}))}
}
