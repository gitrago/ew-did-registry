import React from 'react';
import { Provider } from 'react-redux';
import ReactDOM from 'react-dom';
import AppRouter from './routes';
import store from './state-management';
import './index.css';
import * as serviceWorker from './serviceWorker';

const { ethereum } = window;
console.log('ethereum:', ethereum);
const { isMetaMask, isConnected } = ethereum;
console.log('isMetaMask:', isMetaMask);
console.log('isConnected:', isConnected);
ethereum.enable()
  .then((addresses) => {
    console.log('enabled address:', addresses);
  });

console.log('SERVER_URL:', process.env.REACT_APP_SERVER_URL);

ReactDOM.render(
  <Provider store={store}>
    <AppRouter />
  </Provider>,
  document.getElementById('root'),
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
