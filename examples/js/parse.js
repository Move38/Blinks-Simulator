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

    // replace enum
    fileData = replaceEnum(fileData)

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
    fileData = fileData.replaceAll(/.*?randomize\(.?\)\;/g, '');

    // remove linebreak 
    // fileData = fileData.replace(/\n\s*\n/g, '\n');

    return fileData;
}

function removeComments(string) {
    //remove inline comments
    // const re = /(?<!:)\/\/.*/g 
    const re = /\/\/.*/g // this replaces web urls, current safari does not support lookbehind
    let result = string
    result = result.replaceAll(re, '');
    return result;
}

function removeExtras(string) {
    let result = string
    result = result.replaceAll('const ', '');
    result = result.replaceAll('static ', '');
    // float point postfix
    const floatExp = /([0-9]+)[F|f]/;
    let match = floatExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = floatExp.exec(result);
    }

    // remove array pointers
    const pointerExp = /&([a-zA-Z_{1}][A-Za-z0-9_]+)/;
    match = pointerExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = pointerExp.exec(result);
    }
    const starExp = /\*([a-zA-Z_{1}][A-Za-z0-9_]+)/;
    match = starExp.exec(result);
    while (match != null) {
        result = result.replace(match[0], match[1]);
        match = starExp.exec(result);
    }

    // remove data type caster
    result = result.replaceAll(/\(byte+\s+\*\)/g, '');

    return result;
}

function cleanFuncitons(string) {
    // match line start with a word followed by space and braces
    let result = string;
    const funcExp = /^\s?[a-zA-Z_{1}][A-Za-z0-9_]+\s.*(\(.*\))/gm;
    let match = funcExp.exec(result);
    while (match != null) {
        let funcLine = match[0].replace(match[1], '');
        let paraLine = match[1];
        funcLine = funcLine.replace('void ', 'function ');
        dataTypes.map(d => {
            funcLine = funcLine.replace(d + ' ', 'function ');
            paraLine = paraLine.replaceAll(d + ' ', '');
        })
        // remove array square brackets if there are any
        paraLine = paraLine.replaceAll('[]', '');
        let replacement = funcLine + paraLine;
        result = result.replace(match[0], replacement);
        match = funcExp.exec(result);
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
            if(arrayDim == 1){
                arrLine = '[]';
            }
            else if(arrayDim == 2){
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
        if(arrMatch){
            const arrLength = arrMatch[1].trim();
            replacement = "let " + varable + " = " + "Array.from({ length: " + arrLength + " }, () => new Timer(self));"
        }

        result = result.replace(match[0], replacement);
        match = timerExp.exec(result);
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
        result = result.replace(line, 'for(let x = 0; x < FACE_COUNT; x++)'.replaceAll('x', varable));
        match = forEachExp.exec(result);
    }
    return result;
}

module.exports = { parseCode };