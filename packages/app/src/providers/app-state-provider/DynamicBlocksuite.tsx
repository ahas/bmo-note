import { useEffect } from 'react';
import type { Page } from '@blocksuite/store';
import '@blocksuite/blocks';
import { EditorContainer } from '@blocksuite/editor';
import { CreateEditorHandler } from './interface';

type Props = {
  setCreateEditorHandler: (handler: CreateEditorHandler) => void;
};

const DynamicBlocksuite = ({ setCreateEditorHandler }: Props) => {
  useEffect(() => {
    const createEditorHandler: CreateEditorHandler = (page: Page) => {
      const editor = new EditorContainer();
      editor.page = page;
      return editor;
    };

    setCreateEditorHandler(createEditorHandler);
  }, [setCreateEditorHandler]);

  return <></>;
};

export default DynamicBlocksuite;
