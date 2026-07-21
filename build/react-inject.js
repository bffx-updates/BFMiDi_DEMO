// Shim React -> Preact, via esbuild "inject". Quando algum arquivo do
// bundle usa o identifier "React" ou "ReactDOM" sem declarar, esbuild
// prepende um import deste arquivo automaticamente.
//
// preact/compat tem a maioria da API React, exceto createRoot/hydrateRoot
// (que vivem em preact/compat/client pra espelhar react-dom/client).
// Como o app.jsx faz ReactDOM.createRoot(...), juntamos os dois aqui.
import {
  Component, Fragment, createElement, createRef, render,
  memo, forwardRef, cloneElement, isValidElement, createContext,
  createPortal,
  useState, useEffect, useCallback, useRef, useMemo, useContext,
  useReducer, useLayoutEffect, useImperativeHandle, useDebugValue,
} from 'preact/compat';
import { createRoot, hydrateRoot } from 'preact/compat/client';

const ReactCompat = {
  Component, Fragment, createElement, createRef, render,
  createRoot, hydrateRoot,
  createPortal,
  memo, forwardRef, cloneElement, isValidElement, createContext,
  useState, useEffect, useCallback, useRef, useMemo, useContext,
  useReducer, useLayoutEffect, useImperativeHandle, useDebugValue,
};

export const React = ReactCompat;
export const ReactDOM = ReactCompat;
