import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { SortControl } from "./UIPrimitives.jsx";

afterEach(cleanup);

const COLUMNS = [["name", "Montée"], ["gain", "D+"], ["avgGrade", "Pente moy."]];

describe("SortControl — tri mobile", () => {
  it("expose chaque critère disponible et sélectionne le critère courant", () => {
    render(<SortControl label="Trier les montées" columns={COLUMNS} sort={{ key: "gain", dir: 1 }} onSortKey={() => {}} onToggleDir={() => {}} />);
    const select = screen.getByLabelText("Trier par");
    expect(select.value).toBe("gain");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Montée", "D+", "Pente moy."]);
  });

  it("retombe sur le premier critère si le tri courant n'est pas une colonne proposée (ex. tri par défaut « id »)", () => {
    render(<SortControl label="Trier" columns={COLUMNS} sort={{ key: "id", dir: 1 }} onSortKey={() => {}} onToggleDir={() => {}} />);
    expect(screen.getByLabelText("Trier par").value).toBe("name");
  });

  it("appelle onSortKey avec la clé choisie, et onToggleDir au clic sur le sens", () => {
    const onSortKey = vi.fn();
    const onToggleDir = vi.fn();
    render(<SortControl label="Trier" columns={COLUMNS} sort={{ key: "name", dir: 1 }} onSortKey={onSortKey} onToggleDir={onToggleDir} />);
    fireEvent.change(screen.getByLabelText("Trier par"), { target: { value: "avgGrade" } });
    expect(onSortKey).toHaveBeenCalledWith("avgGrade");
    fireEvent.click(screen.getByRole("button", { name: /Ordre croissant/ }));
    expect(onToggleDir).toHaveBeenCalledTimes(1);
  });

  it("annonce le sens décroissant dans le nom accessible du bouton", () => {
    render(<SortControl label="Trier" columns={COLUMNS} sort={{ key: "name", dir: -1 }} onSortKey={() => {}} onToggleDir={() => {}} />);
    expect(screen.getByRole("button", { name: /Ordre décroissant/ })).toBeTruthy();
  });
});
