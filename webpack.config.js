const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

/**
 * One config, two outputs:
 *   webpack                -> normal dev/build (bundle + index.html)
 *   webpack --env playable -> single self-contained index.html (the playable ad)
 *
 * The playable build inlines the JS into the HTML. Assets are procedural (drawn at runtime),
 * so there are no external files to inline: the build is self-contained by construction. When
 * real sprite PNGs are added they import through `asset/inline` and get base64'd into the file.
 */
module.exports = (env = {}) => {
  const playable = !!env.playable;

  const plugins = [
    new HtmlWebpackPlugin({
      template: './index.html',
      inject: 'body',
      minify: playable,
    }),
  ];
  if (playable) plugins.push(new HtmlInlineScriptPlugin());

  return {
    mode: playable ? 'production' : 'development',
    entry: './src/main.ts',
    devtool: playable ? false : 'eval-source-map',
    devServer: {
      port: 9000,
      static: { directory: path.resolve(__dirname, 'dist') },
      open: true,
    },
    output: {
      filename: playable ? 'bundle.js' : 'bundle.[contenthash].js',
      path: path.resolve(__dirname, 'dist'),
      clean: true,
      publicPath: '',
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        { test: /\.(png|webp|jpg|jpeg)$/, type: 'asset/inline' },
        { test: /\.json$/, type: 'json' },
      ],
    },
    plugins,
  };
};
