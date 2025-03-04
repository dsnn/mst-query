import { destroy, IAnyModelType, Instance } from 'mobx-state-tree';
import { QueryStore } from './QueryStore';

type QueryClientConfig<T extends IAnyModelType> = {
    env?: any;
    queryOptions?: {
        staleTime?: number;
    };
    RootStore: T;
};

const defaultConfig = {
    env: {},
    queryOptions: {
        staleTime: 0,
    },
};

export class QueryClient<T extends IAnyModelType> {
    config: QueryClientConfig<T>;
    rootStore!: Instance<T>;
    queryStore!: QueryStore;
    #initialized = false;
    #initialData = {} as any;

    constructor(config: QueryClientConfig<T>) {
        this.config = {
            ...defaultConfig,
            ...config,
            queryOptions: {
                ...defaultConfig.queryOptions,
                ...config.queryOptions,
            },
        };
    }

    init(initialData: any = {}, env = {}) {
        if (this.#initialized) {
            return this;
        }

        this.config.env = env;
        this.config.env.queryClient = this;

        this.rootStore = this.config.RootStore.create(initialData, this.config.env);        
        this.queryStore = new QueryStore(this);

        this.#initialized = true;

        return this;
    }

    reset() {
        destroy(this.rootStore);
        this.rootStore = this.config.RootStore.create(this.#initialData, this.config.env);
        this.queryStore = new QueryStore(this);
    }

    
}
