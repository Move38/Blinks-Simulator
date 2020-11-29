const path = require('path');

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'blinks.js',
        path: path.resolve(__dirname, 'build'),
        pathinfo: false,
        library: 'blinks',
        libraryTarget: "umd",
    },
    devServer: {
        contentBase: [
            path.resolve(__dirname, './examples'),
            path.resolve(__dirname, './build')
        ],
        compress: true,
        port: 8000
    },
};