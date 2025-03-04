import { GeneratedField } from '../models';
import { FieldHandlerProps, IHandleField, ModelFieldRef, HandlerOptions } from '../types';

export const handleObjectField: IHandleField = (
    props: FieldHandlerProps,
    options: HandlerOptions
): GeneratedField | null => {
    const {
        rootType,
        field,
        fieldType,
        knownTypes,
        isNullable = false,
        isNested = false,
        refs,
    } = props;
    const { addImport } = options;

    if (fieldType?.kind.isObject) {
        const isSelf = Boolean(fieldType.name === rootType?.name);
        const isKnownType = fieldType.name ? knownTypes?.includes(fieldType.name) : false;

        if (!isKnownType) {
            // unknown or unhandled type. make it frozen.
            return new GeneratedField({ value: `types.frozen()` });
        }

        const modelType = `${fieldType.name}Model`;
        const modelTypeType = `${fieldType.name}ModelType`;
        addImport?.(modelType, modelType);
        addImport?.(modelType, modelTypeType);

        // use late to prevent circular dependency
        const realType = `types.late(():any => ${fieldType.name}Model)`;

        // this object is not a root type, so assume composition relationship
        if (!isSelf && !isKnownType) {
            return new GeneratedField({ value: realType, isNullable, isNested });
        }

        const fieldMatch = refs?.find((ref) => ref.fieldName === field.name);
        const fieldName = field.name;

        // handle union fields for withTypeRefs
        if (fieldMatch) {
            const index = refs.indexOf(fieldMatch);
            const newModelTypeName = `${fieldMatch.modelType} | ${modelTypeType}`;
            refs[index] = { fieldName, modelType: newModelTypeName, isNested } as ModelFieldRef;
        } else {
            const refItem = { fieldName, modelType: modelTypeType, isNested } as ModelFieldRef;
            refs?.push(refItem);
        }

        return new GeneratedField({ value: `${realType}`, isNullable, isNested });
    }

    return null;
};
