const fs = require('fs');
const requireFromString = require('require-from-string');
const filepath = process.argv[2];

const parserCode = fs.readFileSync('./examples/js/parse.js');
const parser = requireFromString(parserCode + '\nmodule.exports = { parseCode };');

if (filepath) {
    fs.readFile('./' + filepath, 'utf8', function (error, data) {
        if (error) {
            throw error;
        }
        const jsCode = parser.parseCode(data.toString());

        //path.parse(filepath).name 
        fs.writeFile('./scripts/temp.js', jsCode, (err) => {
            if (err) throw err;
            console.log('The file has been saved!');
        });
    });
}