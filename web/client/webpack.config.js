const path = require("path");
const webpack = require("webpack");

module.exports = {
  entry: {
    index: [path.resolve(__dirname, './index.js')],
    service: [path.resolve(__dirname, './service.js')]
  },
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /(node_modules|bower_components)/,
        loader: "babel-loader",
        options: { 
          presets: [["@babel/env", {"useBuiltIns": "usage", "corejs": "3.9"}], "@babel/preset-react"],
          plugins: ["@babel/plugin-proposal-class-properties"]
        }
      }
    ]
  },
  resolve: { extensions: ["*", ".js", ".jsx"] },
  output: {
    path: path.resolve(__dirname, "./dist/"),
    filename: '[name].js'
  }
};
