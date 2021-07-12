import {
    destroy,
    Instance,
    IAnyModelType,
    isStateTreeNode,
    isAlive,
    getType,
    isArrayType,
    getIdentifier,
} from 'mobx-state-tree';
import { objMap } from './MstQueryRef';
import { observable, action, makeObservable } from 'mobx';
import { QueryModelType } from './QueryModel';
import { MutationModelType } from './MutationModel';
import { QueryStatus, QueryType } from './UtilityTypes';
import { SubscriptionModelType } from './SubscriptionModel';

export class QueryCache {
    _scheduledGc = null as null | number;
    cache = observable.map({}, { deep: false });
    
    constructor() {
        makeObservable(this, {
            setQuery: action,
            removeQuery: action,
            clear: action
        });
    }

    find<P extends IAnyModelType>(
        queryDef: P,
        matcherFn?: (query: Instance<P>) => boolean
    ): Instance<P> | undefined {
        const matches = this.findAll(queryDef, matcherFn);
        return matches?.[0];
    }

    findAll<P extends IAnyModelType>(
        queryDef: P,
        matcherFn: (query: Instance<P>) => boolean = () => true,
        includeStale = false
    ): Instance<P>[] {
        let results = [];
        for (let [_, arr] of this.cache) {
            for (let query of arr) {
                if (!includeStale && query.__MstQueryHandler?.status === QueryStatus.Stale) {
                    continue;
                }
                if (getType(query) === queryDef && matcherFn(query)) {
                    results.push(query);
                }
            }
        }

        return results;
    }

    setQuery<T extends QueryType>(q: Instance<T>) {
        const type = getType(q);
        let arr = this.cache.get(type.name);
        if (!arr) {
            arr = observable.array([], { deep: false });
            this.cache.set(type.name, arr);
        }
        arr.push(q);
    }

    removeQuery(query: QueryModelType | MutationModelType | SubscriptionModelType) {
        const type = getType(query);
        this.cache.get(type.name).remove(query);
        destroy(query);

        this._runGc();
    }

    _runGc() {
        if (this._scheduledGc) {
            return;
        }

        const seenIdentifiers = new Set();
        for (let [_, arr] of this.cache) {
            for (let query of arr) {
                if (query.isLoading) {
                    this._scheduledGc = window.setTimeout(() => {
                        this._scheduledGc = null;
                        this._runGc();
                    }, 1000);

                    return;
                }

                collectSeenIdentifiers(query.data, seenIdentifiers);
                collectSeenIdentifiers(query.request, seenIdentifiers);
            }
        }

        for (let [key, obj] of objMap) {
            if (!seenIdentifiers.has(key)) {
                destroy(obj);
                objMap.delete(key);
            }
        }
    }

    clear() {
        for (let [, arr] of this.cache) {
            for (let query of arr) {
                destroy(query);
            }
        }

        for (let [, obj] of objMap) {
            destroy(obj);
        }

        objMap.clear();
        this.cache.clear();
    }
}

export function collectSeenIdentifiers(node: any, seenIdentifiers: any) {
    if (!isStateTreeNode(node)) {
        return;
    }
    if (!isAlive(node)) {
        return;
    }
    if (!node || node instanceof Date || typeof node !== 'object') {
        return;
    }
    const n = node as any;
    const t = getType(node) as any;
    if (isArrayType(t)) {
        n.forEach((n: any) => collectSeenIdentifiers(n, seenIdentifiers));
        return;
    }

    const nodeIdentifier = getIdentifier(n);
    if (nodeIdentifier) {
        const identifier = `${t.name}:${nodeIdentifier}`;

        if (seenIdentifiers.has(identifier)) {
            return;
        } else {
            seenIdentifiers.add(identifier);
        }
    }

    for (const key in t.properties) {
        collectSeenIdentifiers(n[key], seenIdentifiers);
    }
}

export default new QueryCache();
