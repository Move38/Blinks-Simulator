const fs = require("fs");
const prettier = require("prettier");
const cparse = require('./cparse.js');

fs.readFile('./scripts/tests/test.ino', 'utf8', function (error, data) {
    if (error) {
        throw error;
    }

    let fileData = data.toString();

    var test = prettier.format(fileData, { parser: "babel" });
    console.log(fileData);

    // // clean up FOREACH_FACE
    // const forEachExp = /FOREACH_FACE(.*?)\)/g;
    // let match = forEachExp.exec(fileData);
    // while (match != null) {
    //     const v = match[0].replace('FOREACH_FACE', '').replace('(', '').replace(')', '').trim();
    //     // console.log(match[0], v)
    //     fileData = fileData.replace(match[0], 'for(int x = 0; x < 6; ++x)'.replaceAll('x', v));
    //     match = forEachExp.exec(fileData);
    // }

    // const ast = cparse(fileData);
    // printJS(ast);

});

function printJS(ast) {
    let result = '';
    console.log(JSON.stringify(ast, undefined, 4));
    // console.log(result);
}