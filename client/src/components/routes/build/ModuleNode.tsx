import { Handle, Position } from "@xyflow/react";
import clsx from "clsx";
import React, { FC, Fragment } from "react";

interface IModuleProps {
  data: {
    label: string;
    isRoot: boolean;
  };
}

export const ModuleNode: FC<IModuleProps> = ({ data }) => {
  return (
    <Fragment>
      <Handle type="target" position={Position.Top} />
      <div
        className={clsx(
          "h-full w-full text-wrap break-words p-4 rounded-md shadow-xl",
          data.isRoot
            ? "bg-blue-500 text-white shadow-blue-500/30"
            : "bg-white shadow-gray-500/10"
        )}
      >
        <h1>{data.label}</h1>
      </div>
      <Handle type="source" position={Position.Bottom} id="a" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </Fragment>
  );
};
