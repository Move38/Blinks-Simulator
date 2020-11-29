const path = require('path');

module.exports = (env, arg) => {
    const isProd = arg.mode === 'production'

    return {
        mode: 'development',
        entry: './src/index.js',
        output: {
            filename: `blinks${isProd ? '.min' : ''}.js`,
            path: path.resolve(__dirname, 'build'),
            pathinfo: false,
            library: 'blinks',
            libraryTarget: "umd",
        },
        optimization: { minimize: isProd },
        devServer: {
            contentBase: [
                path.resolve(__dirname, './examples'),
                path.resolve(__dirname, './build')
            ],
            compress: true,
            port: 8000
        }
    }
};