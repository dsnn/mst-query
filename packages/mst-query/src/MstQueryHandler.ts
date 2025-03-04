import equal from '@wry/equality';
import { makeObservable, observable, action } from 'mobx';
import {
    getEnv,
    getIdentifier,
    getRoot,
    getSnapshot,
    getType,
    IPatchRecorder,
    isReferenceType,
    isStateTreeNode,
    recordPatches,
} from 'mobx-state-tree';
import { merge } from './merge';
import { QueryClient } from './QueryClient';

type QueryReturn<TData, TResult> = {
    data: TData;
    error: any;
    result: TResult;
};

type Context = {
    fetchOptions?: {
        signal: AbortSignal;
    };
    [key: string]: any;
};

type BaseOptions = {
    request?: any;
    context?: Context;
    convert?: (result: any) => any;
    endpoint?: EndpointType;
};

type MutateOptions = BaseOptions & {
    optimisticUpdate?: () => void;
};

type QueryOptions = BaseOptions & {
    request?: any;
    pagination?: any;
};

type QueryHookOptions = {
    request?: any;
    staleTime?: number;
    pagination?: any;
    enabled?: boolean;
    isMounted?: any;
};

type NotifyOptions = {
    onSuccess?: boolean;
    onError?: boolean;
    onFetched?: boolean;
    onQueryMore?: boolean;
};

const EmptyRequest = Symbol('EmptyRequest');
const EmptyPagination = Symbol('EmptyPagination');

export type EndpointType = (options: QueryOptions, query: any) => Promise<any>;

export class DisposedError extends Error {}

export class QueryObserver {
    query: any;
    options: any;
    isQuery: boolean;
    isMounted = false;

    constructor(query: any, isQuery: boolean) {
        this.query = query;
        this.isQuery = isQuery;
    }

    subscribe() {
        this.query.__MstQueryHandler.addQueryObserver(this);
    }

    unsubscribe() {
        this.query.__MstQueryHandler.removeQueryObserver(this);
    }

    setOptions(options: any, ...args: any[]) {
        this.options = options;

        this.subscribe();

        if (this.isQuery) {
            options.isMounted = this.isMounted;
            this.query.__MstQueryHandler.queryWhenChanged(options, ...args);
        }

        if (!this.isMounted && !this.query.__MstQueryHandler.isFetched && options.initialData) {
            this.query.__MstQueryHandler.setData(options.initialData);
        }

        if (!this.isMounted) {
            this.isMounted = true;
        }
    }
}

export class MstQueryHandler {
    isLoading = false;
    isRefetching = false;
    isFetchingMore = false;
    isFetched = false;
    error: any = null;
    queryObservers = [] as any[];

    result: any;
    options: {
        endpoint: EndpointType;
    };

    previousVariables: any;
    model: any;
    type: any;
    queryClient!: QueryClient<any>;

    abortController?: AbortController;

    cachedAt?: Date;

    isDisposed = false;

    constructor(model: any, options?: any) {
        this.model = model;
        this.type = getType(model) as any;

        this.options = options ?? {};
        this.queryClient = getEnv(this.model).queryClient;

        this.model.$treenode.registerHook('afterCreate', () => this.onAfterCreate());
        this.model.$treenode.registerHook('beforeDestroy', () => this.onBeforeDestroy());

        makeObservable(this, {
            isLoading: observable,
            isRefetching: observable,
            isFetchingMore: observable,
            isFetched: observable,
            error: observable,
            updateData: action.bound,
            setResult: action.bound,
            setError: action.bound,
            run: action.bound,
            query: action.bound,
            mutate: action.bound,
            queryMore: action.bound,
            refetch: action.bound,
            abort: action.bound,
            onAfterCreate: action.bound,
            onBeforeDestroy: action.bound,
        });
    }

    run(options: QueryOptions = {}) {
        const endpoint = options.endpoint ?? this.options.endpoint;

        this.setVariables({ request: options.request, pagination: options.pagination });

        if (this.isLoading && this.abortController) {
            this.abortController.abort();
        }

        const abortController = new AbortController();
        this.abortController = abortController;

        this.isLoading = true;
        this.error = null;

        const opts = {
            ...options,
            context: {
                fetchOptions: {
                    signal: this.abortController.signal,
                },
                ...options?.context,
            },
        };

        return endpoint(opts, this.model).then((result: any) => {
            if (abortController?.signal.aborted || this.isDisposed) {
                throw new DisposedError();
            }
            if (options.convert) {
                return options.convert(result);
            }
            return result;
        });
    }

    async queryWhenChanged(options: QueryHookOptions, queryAction: any, queryMoreAction?: any) {
        if (this.isDisposed) {
            return;
        }

        if (!options.enabled) {
            return;
        }

        options.request = options.request ?? EmptyRequest;
        options.pagination = options.pagination ?? EmptyPagination;

        if (!options.isMounted) {
            const notInitialized = !this.isFetched && !this.isLoading;
            if (notInitialized) {
                return queryAction(options.request, options.pagination);
            }

            const now = new Date();
            const cachedAt = this.cachedAt?.getTime() ?? now.getTime();
            const isStale = now.getTime() - cachedAt >= (options.staleTime ?? 0);
            if (isStale) {
                return queryAction(options.request, options.pagination);
            }
        }

        const isRequestEqual = equal(options.request, this.model.variables.request);
        if (!isRequestEqual) {
            return queryAction(options.request, options.pagination);
        }

        if (queryMoreAction && this.isFetched) {
            const isPaginationEqual = equal(options.pagination, this.model.variables.pagination);
            if (!isPaginationEqual) {
                return queryMoreAction(options.request, options.pagination);
            }
        }
    }

    query<TData, TResult>(options: QueryOptions = {}): Promise<() => QueryReturn<TData, TResult>> {
        return this.run(options).then(
            (result) => this.onSuccess(result),
            (err) => this.onError(err)
        );
    }

    mutate<TData, TResult>(
        options: MutateOptions = {}
    ): Promise<() => QueryReturn<TData, TResult>> {
        const { optimisticUpdate } = options;
        let recorder: IPatchRecorder;
        if (optimisticUpdate) {
            recorder = recordPatches(getRoot(this.model));
            optimisticUpdate();
            recorder.stop();
        }
        return this.run(options).then(
            (result) => this.onSuccess(result, true, recorder),
            (err) => this.onError(err, true, recorder)
        );
    }

    queryMore<TData, TResult>(
        options: QueryOptions = {}
    ): Promise<() => QueryReturn<TData, TResult>> {
        this.isFetchingMore = true;

        return this.run(options).then(
            (result) => this.onSuccess(result, false),
            (err) => this.onError(err, false)
        );
    }

    refetch<TData, TResult>(
        options: QueryOptions = {}
    ): Promise<() => QueryReturn<TData, TResult>> {
        this.isRefetching = true;

        options.request = options.request ?? this.model.variables.request;
        options.pagination = options.pagination ?? this.model.variables.pagination;

        return this.run(options).then(
            (result) => this.onSuccess(result),
            (err) => this.onError(err)
        );
    }

    onSuccess(result: any, shouldUpdate = true, recorder?: IPatchRecorder) {
        return (): { data: any; error: any; result: any } => {
            if (recorder) {
                recorder.undo();
            }

            if (this.isDisposed) {
                return { data: null, error: null, result: null };
            }

            this.setResult(result);

            let data;
            if (shouldUpdate) {
                data = this.updateData(result);
            } else {
                data = this.prepareData(result);
            }
            this.cachedAt = new Date();

            if (this.error) {
                this.error = null;
            }

            if (this.isLoading) {
                this.isLoading = false;
            }

            if (this.isRefetching) {
                this.isRefetching = false;
            }

            if (this.isFetchingMore) {
                this.isFetchingMore = false;
                this.notify({ onQueryMore: true }, data, this.model);
            }

            if (!this.isFetched) {
                this.isFetched = true;
                this.notify({ onFetched: true }, this.model.data, this.model);
            }

            this.notify({ onSuccess: true }, data, this.model);

            return { data, error: null, result };
        };
    }

    onError(err: any, shouldUpdate = true, recorder?: IPatchRecorder) {
        return (): { data: any; error: any; result: any } => {
            if (recorder) {
                recorder.undo();
            }

            if (this.isDisposed) {
                return { data: null, error: null, result: null };
            }

            if (err instanceof DisposedError) {
                return { data: null, error: null, result: null };
            }

            if (shouldUpdate) {
                this.updateData(null);
            }

            this.error = err;

            if (this.isLoading) {
                this.isLoading = false;
            }

            if (this.isRefetching) {
                this.isRefetching = false;
            }

            if (this.isFetchingMore) {
                this.isFetchingMore = false;
            }

            this.notify({ onError: true }, err, this.model);

            return { data: null, error: err, result: null };
        };
    }

    addQueryObserver(queryObserver: any) {
        if (!this.queryObservers.includes(queryObserver)) {
            this.queryObservers.push(queryObserver);
        }
    }

    removeQueryObserver(queryObserver: any) {
        this.queryObservers = this.queryObservers.filter((observer) => observer !== queryObserver);
    }

    notify(notifyOptions: NotifyOptions, ...args: any[]) {
        for (let observer of this.queryObservers) {
            if (notifyOptions.onSuccess) {
                observer.options.onSuccess?.(...args);
            } else if (notifyOptions.onError) {
                observer.options.onError?.(...args);
            }
            if (notifyOptions.onQueryMore) {
                observer.options.onQueryMore?.(...args);
            }
            if (notifyOptions.onFetched) {
                observer.options.onFetched?.(...args);
            }
        }
    }

    abort() {
        this.abortController?.abort();
        this.abortController = undefined;

        if (!this.isDisposed) {
            this.revertVariables();
        }
    }

    setResult(result: any) {
        this.result = result;
    }

    setError(error: any) {
        this.error = error;
    }

    setOptions(options: any) {
        this.options = { ...this.options, ...options };
    }

    setVariables(variables: any) {
        this.previousVariables = this.model.variables;
        this.model.__MstQueryHandlerAction(() => {
            variables.request = variables.request ?? EmptyRequest;
            variables.pagination = variables.pagination ?? EmptyPagination;
            this.model.variables = variables;
        });
    }

    revertVariables() {
        this.model.__MstQueryHandlerAction(() => {
            this.model.variables = this.previousVariables;
        });
    }

    prepareData(data: any) {
        return merge(data, this.type.properties.data, this.queryClient.config.env, true);
    }

    setData(data: any) {
        this.model.__MstQueryHandlerAction(() => {
            if (isStateTreeNode(data)) {
                if (isReferenceType(this.type.properties.data)) {
                    this.model.data = getIdentifier(data);
                } else {
                    this.model.data = getSnapshot(data);
                }
            } else {
                this.model.data = merge(
                    data,
                    this.type.properties.data,
                    this.queryClient.config.env
                );
            }
        });
    }

    updateData(data: any) {
        if (data) {
            this.setData(data);
        }

        return this.model.data;
    }

    onAfterCreate() {
        this.queryClient.queryStore.setQuery(this.model);
    }

    onBeforeDestroy() {
        this.queryClient.queryStore.removeQuery(this.model);
        this.isDisposed = true;
        this.abort();
    }
}
