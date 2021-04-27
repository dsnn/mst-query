import { flow, types } from 'mobx-state-tree';
import { createQuery, MstQueryRef } from '../../src';
import { ItemModel } from './ItemModel';

export const ListQuery = createQuery('ListQuery', {
    data: types.model({ items: types.array(MstQueryRef(ItemModel)) }),
    request: types.frozen(),
    env: types.frozen(),
}).actions((self) => ({
    run: flow(function* () {
        const next = yield self.query(self.env.api.getItems);
        next();
    }),
    addItem(item: any) {
        self.data?.items.push(item);
    },
}));
