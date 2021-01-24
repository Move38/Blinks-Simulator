/*
*   Convert C++ code in .ino file intop Javascript
*   Everything is done in Regex, it only supports simple C++ code
*   Class files are not supported at this moment
*   Todo: Use tree structure to parse functions
*/


let dataTypes = [
    'unsigned byte',
    'unsigned int',
    'unsigned long',
    'byte',
    'word',
    'int',
    'long',
    'float',
    'double',
    'boolean',
    'bool',
    'uint16_t',
    'uint32_t',
    'Timer',
    'Color'
]

let customDataTypes = [];

function parseCode(fileData) {
    // remove comments
    fileData = removeComments(fileData)

    // remove const static
    fileData = removeExtras(fileData)

    // replace Serial
    fileData = replaceSerial(fileData)

    // replace enum
    fileData = replaceEnum(fileData)

    // replace typedef, include typedef struct
    fileData = replaceTypeDef(fileData)

    // replace struct
    fileData = replaceStruct(fileData)

    // replace void loop and void setup
    fileData = cleanFuncitons(fileData)

    // replace define
    fileData = replaceDefine(fileData)

    // replace forEach
    fileData = replaceForEach(fileData)

    // update timer definition
    fileData = updateTimer(fileData)

    // clean data types
    fileData = cleanDatatypes(fileData)

    // remove randomize()
    fileData = fileData.replace(/.*?randomize\(.?\)\;/g, '');

    // remove linebreak 
    // fileData = fileData.replace(/\n\s*\n/g, '\n');

    return fileData;
}

function removeComments(string) {
    //remove inline comments
    // const re = /(?<!:)\/\/.*/g 
    const re = /\/\/.*/g // this replaces web urls, current safari does not support lookbehind
    let result = string
    result = result.replace(re, '');
    return result;
}

function removeExtras(string) {
    let result = string
    result = result.replace(/const /g, '');
    result = result.replace(/static /g, '');
    // float point postfix
    const floatExp = /([0-9]+)[F|f]/;
    let match = floatExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = floatExp.exec(result);
    }
    
    // remove arrow operator
    result = result.replace(/\s*->\s*/g, '.');

    // remove array pointers
    const pointerExp = /&([a-zA-Z_{1}][A-Za-z0-9_]+)/;
    match = pointerExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = pointerExp.exec(result);
    }
    let starExp = /\*([a-zA-Z_{1}][A-Za-z0-9_]+)/;
    match = starExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = starExp.exec(result);
    }
    starExp = /([a-zA-Z_{1}][A-Za-z0-9_]+)\*/;
    match = starExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = starExp.exec(result);
    }

    // remove data type caster
    result = result.replace(/\(byte+\s+\*\)/g, '');

    return result;
}

function cleanFuncitons(string) {
    let result = string;
    let allTypes = dataTypes.concat(customDataTypes).concat(['void']);
    for (let i = 0; i < allTypes.length; i++) {
        const funcExp = new RegExp('^\\s?' + allTypes[i] + '\\s+([A-Za-z0-9\\_]+)\\s*\\((.*)\\)', 'gm');
        let match = funcExp.exec(result);
        while (match != null) {
            let funcLine = 'function ' + match[1];
            let paraLine = match[2].split(',').map( p => {
                return p.trim().split(' ').pop().replace('[]', '');
            }).join(',');
            let replacement = funcLine + '(' + paraLine + ')';
            result = result.replace(match[0], replacement);
            match = funcExp.exec(result);
        }
    }
    return result;
}

function cleanDatatypes(string) {
    let result = string;
    // match line with datetype followed by varable name followed by square braces
    const arrExp = /[a-zA-Z_{1}][A-Za-z0-9_]+\s+([a-zA-Z_{1}][A-Za-z0-9_]+)(\[.*\]).*/;
    let typeMatch = arrExp.exec(result);
    while (typeMatch != null) {
        let varable = typeMatch[1];
        let arrLine = ''
        let arrMatch = /\{(.+)\}/.exec(typeMatch[0]);
        if (arrMatch) {
            arrLine = '[' + arrMatch[1] + '];';
        }
        else {
            const arrayDim = (typeMatch[2].match(/\[/g) || []).length
            if (arrayDim == 1) {
                arrLine = '[]';
            }
            else if (arrayDim == 2) {
                const length = /\[([0-9]+)\]/.exec(typeMatch[2])[1]
                arrLine = "Array.from({ length: " + length + " }, () => [])"
            }
        }

        let replacement = 'let ' + varable + ' = ' + arrLine;
        result = result.replace(typeMatch[0], replacement);
        typeMatch = arrExp.exec(result);
    }

    const allTypes = dataTypes.concat(customDataTypes);
    for (let i = 0; i < allTypes.length; i++) {
        const typeExp = new RegExp('\\s?' + allTypes[i] + '\\s+[A-Za-z0-9\\_]+', 'g');
        typeMatch = typeExp.exec(result);
        while (typeMatch != null) {
            let replacement = typeMatch[0].replace(allTypes[i], 'let');
            result = result.replace(typeMatch[0], replacement);
            typeMatch = typeExp.exec(result);
        }
    }
    return result;
}

function updateTimer(string) {
    const timerExp = /Timer\s+([a-zA-Z_{1}][A-Za-z0-9_]+).*;?/;
    let result = string;
    let match = timerExp.exec(string);
    while (match != null) {
        const varable = match[1];
        let replacement = "let " + varable + " = new Timer(self);";
        // check whether it's an array
        const arrExp = /\[(.*)\]/;
        const arrMatch = arrExp.exec(match[0]);
        if (arrMatch) {
            const arrLength = arrMatch[1].trim();
            replacement = "let " + varable + " = " + "Array.from({ length: " + arrLength + " }, () => new Timer(self));"
        }

        result = result.replace(match[0], replacement);
        match = timerExp.exec(result);
    }
    return result;
}

function replaceSerial(string) {
    const serialExp = /.*?(Serial.print(ln)?);?/;
    let result = string;
    let match = serialExp.exec(string);
    while (match != null) {
        result = result.replace(match[0], 'console.log');
        match = serialExp.exec(result);
    }
    return result;
}

function replaceDefine(string) {
    const defineExp = /.*?#define\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\s+/;
    let result = string;
    let match = defineExp.exec(string);
    while (match != null) {
        let replacement = "const " + match[1] + ' = ';
        result = result.replace(match[0], replacement);
        match = defineExp.exec(result);
    }
    return result;
}

function createStructDef(name, props, values) {
    // console.log(name, props, values);
    if (props.length !== values.length) {
        console.log('warning');
        return ''
    }

    let result = 'let ' + name + ' = ';
    let valueStr = values.map((v, i) => {
        return props[i] + ': ' + v.trim()
    }).join(', ');
    result += '{ ' + valueStr + '};';

    return result;
}

function replaceTypeDef(string) {
    // match and recreate typedef struct
    const typedefStructExp = /typedef\s+struct\s*\{([^\}]*)\}\s*([a-zA-Z_{1}][A-Za-z0-9_]+);?/;
    let result = string;
    let match = typedefStructExp.exec(string);
    while (match != null) {
        result = result.replace(match[0], '');
        const propArray = match[1].split(';').map(p => {
            let cleanProp = p.trim().replace(';', '');
            return cleanProp.length > 0 ? cleanProp.split(' ')[1] : ''
        }).filter(p => p !== '');
        const typeName = match[2];
        // console.log(propArray, typeName)
        customDataTypes.push(typeName);
        let typedefNameExp = new RegExp('^' + typeName + '\\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\\s*=\\s*\\{([^\\}]*)\\}.*?;?', 'm');
        let mm = typedefNameExp.exec(result);
        while (mm != null) {
            result = result.replace(mm[0], createStructDef(mm[1], propArray, mm[2].split(',')));
            mm = typedefNameExp.exec(result);
        }
        typedefNameExp = new RegExp('^' + typeName + '\\s+([a-zA-Z_{1}][A-Za-z0-9_]+);?', 'm');
        mm = typedefNameExp.exec(result);
        while (mm != null) {
            result = result.replace(mm[0], 'let ' + mm[1] + ' = {};');
            mm = typedefNameExp.exec(result);
        }
        match = typedefStructExp.exec(result);
    }

    // replace typedef functions
    const returnTypes = dataTypes.concat(['void']);
    for (let i = 0; i < returnTypes.length; i++) {
        const typeDefFuncExp = new RegExp('typedef\\s+' + returnTypes[i] + '\\s+\\((.*?)\\)\\s*\\(.*?\\)\\s*;?', 'g');
        match = typeDefFuncExp.exec(result);
        while (match != null) {
            customDataTypes.push(match[1]);
            result = result.replace(match[0], '');
            match = typeDefFuncExp.exec(result);
        }
    }

    // replace short typedef 
    for (let i = 0; i < dataTypes.length; i++) {
        const typeDefTypeExp = new RegExp('typedef\\s+' + dataTypes[i] + '\\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\\s*;?', 'g');
        match = typeDefTypeExp.exec(result);
        while (match != null) {
            customDataTypes.push(match[1]);
            result = result.replace(match[0], '');
            match = typeDefTypeExp.exec(result);
        }
    }
    return result;
}

function replaceStruct(string) {
    // match and recreate struct
    const structExp = /struct\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\s*{([^\}]*)\}\s*;?/;
    let result = string;
    let match = structExp.exec(string);
    while (match != null) {
        result = result.replace(match[0], '');
        const propArray = match[2].split(';').map(p => {
            let cleanProp = p.trim().replace(';', '');
            return cleanProp.length > 0 ? cleanProp.split(' ')[1] : ''
        }).filter(p => p !== '');
        const structName = match[1];
        // console.log(propArray, structName)
        customDataTypes.push(structName);
        let structDefExp = new RegExp('struct\\s+' + structName + '\\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\\s*=\\s*\\{([^\\}]*)\\}.*?;?', '');
        let mm = structDefExp.exec(result);
        while (mm != null) {
            result = result.replace(mm[0], createStructDef(mm[1], propArray, mm[2].split(',')));
            mm = structDefExp.exec(result);
        }
        structDefExp = new RegExp('struct\\s+' + structName + '\\s+([a-zA-Z_{1}][A-Za-z0-9_]+);?', '');
        mm = structDefExp.exec(result);
        while (mm != null) {
            result = result.replace(mm[0], 'let ' + mm[1] + ' = {};');
            mm = structDefExp.exec(result);
        }
        match = structExp.exec(result);
    }
    return result;
}

function replaceEnum(string) {
    const enumExp = /enum\s+([a-zA-Z_{1}][A-Za-z0-9_]+)\s+\{([^\}]*)\};?/;
    let result = string;
    let match = enumExp.exec(string);
    while (match != null) {
        let line = match[0];
        const varable = match[1];
        const arr = match[2].split(',');
        customDataTypes.push(varable);

        let replacement = ''
        arr.map((v, i) => {
            replacement += "const " + v.trim() + " = " + i + ";\n";
        })
        result = result.replace(line, replacement);
        match = enumExp.exec(result);
    }
    return result;
}

function replaceForEach(string) {
    const forEachExp = /FOREACH_FACE\((.+)\)/g;
    let result = string;
    let match = forEachExp.exec(result);
    while (match != null) {
        const line = match[0];
        const varable = match[1];
        result = result.replace(line, 'for(let x = 0; x < FACE_COUNT; x++)'.replace(/x/g, varable));
        match = forEachExp.exec(result);
    }
    return result;
}